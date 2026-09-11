import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type {
  AddCampRegistrationDto,
  UpdateCampRegistrationDto,
} from './dto/medical-crud.dto';

/**
 * The roster of people registered for a medical camp.
 *
 * `medical_camps` only ever carried a `registered_count` integer — a number
 * with nothing behind it, incremented by a "register a batch" button that
 * invented 60 attendees at a time. This service is the real thing:
 * `medical_camp_registrations` records exactly who is registered, one row per
 * person, and `registered_count` is recomputed from those rows so the figure
 * on screen can always be traced to names.
 *
 * Written with raw SQL on purpose: the table is not in `schema.prisma` (the
 * schema file is owned by the DB owner and not edited from here), so there is
 * no generated Prisma model to go through. The same approach the rest of this
 * module already uses — see medical-sql.util.ts.
 *
 * A registration is a student OR a faculty member, never both and never
 * neither; the DB enforces that with a CHECK constraint, and the partial
 * unique indexes stop the same person being registered for one camp twice.
 */

interface RegistrationRow {
  id: number;
  camp_id: number;
  student_id: number | null;
  faculty_id: number | null;
  remarks: string | null;
  registered_at: Date;
  name: string | null;
  identifier: string | null;
  department: string | null;
  designation: string | null;
}

@Injectable()
export class MedicalCampRegistrationsService {
  private readonly logger = new Logger(MedicalCampRegistrationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async assertCampExists(campId: number): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM medical_camps WHERE id = ${campId}`,
    );
    if (rows.length === 0) {
      throw new NotFoundException({
        message: 'Camp not found',
        errorCode: 'CAMP_NOT_FOUND',
      });
    }
  }

  /**
   * Keeps `medical_camps.registered_count` equal to the number of rows on the
   * roster. Called after every add and remove so the headline figure and the
   * list can never disagree.
   */
  private async syncRegisteredCount(campId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      UPDATE medical_camps
         SET registered_count = sub.n
        FROM (
          SELECT count(*)::int AS n
          FROM medical_camp_registrations
          WHERE camp_id = ${campId}
        ) AS sub
       WHERE medical_camps.id = ${campId}
      RETURNING medical_camps.registered_count AS n
    `);
    return rows[0]?.n ?? 0;
  }

  /**
   * GET /me/medical-centre-camps/:id/registrations
   *
   * Student names live on `soa_applications` (there is no name column on
   * `students`), and the identifier a person is known by differs: roll number
   * for a student, staff code for a faculty member. Both are resolved here so
   * the UI renders one uniform list.
   */
  async list(campId: number) {
    await this.assertCampExists(campId);
    try {
      const rows = await this.prisma.$queryRaw<RegistrationRow[]>(Prisma.sql`
        SELECT r.id,
               r.camp_id,
               r.student_id,
               r.faculty_id,
               r.remarks,
               r.registered_at,
               COALESCE(
                 NULLIF(TRIM(CONCAT_WS(' ', sa.first_name, sa.last_name)), ''),
                 NULLIF(TRIM(CONCAT_WS(' ', f.first_name, f.last_name)), '')
               )                                            AS name,
               COALESCE(s.roll_no, s.register_no, f.staff_code) AS identifier,
               COALESCE(sd.name, fd.name)                   AS department,
               f.designation                                AS designation
        FROM medical_camp_registrations r
        LEFT JOIN students s          ON s.id = r.student_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c           ON c.id = s.class_id
        LEFT JOIN departments sd      ON sd.id = c.department_id
        LEFT JOIN faculty f           ON f.id = r.faculty_id
        LEFT JOIN departments fd      ON fd.id = f.department_id
        WHERE r.camp_id = ${campId}
        ORDER BY r.registered_at DESC, r.id DESC
      `);

      return rows.map((r) => ({
        id: r.id,
        camp_id: r.camp_id,
        kind: r.student_id != null ? ('student' as const) : ('faculty' as const),
        student_id: r.student_id,
        faculty_id: r.faculty_id,
        name: (r.name ?? '').trim() || 'Unknown',
        identifier: r.identifier,
        department: r.department,
        designation: r.designation,
        remarks: r.remarks,
        registered_at: r.registered_at.toISOString(),
      }));
    } catch (err) {
      this.logger.error(`DB error listing registrations for camp ${campId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** POST /me/medical-centre-camps/:id/registrations */
  async add(campId: number, dto: AddCampRegistrationDto, userId: number) {
    await this.assertCampExists(campId);

    const isStudent = dto.student_id != null;
    const isFaculty = dto.faculty_id != null;
    if (isStudent === isFaculty) {
      throw new BadRequestException({
        message: 'Provide exactly one of student_id or faculty_id.',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    // Confirm the person exists before writing, so a bad id becomes a clear
    // 404 rather than a foreign-key error surfacing as a 500.
    const exists = isStudent
      ? await this.prisma.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT id FROM students WHERE id = ${dto.student_id}`,
        )
      : await this.prisma.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT id FROM faculty WHERE id = ${dto.faculty_id}`,
        );
    if (exists.length === 0) {
      throw new NotFoundException({
        message: isStudent ? 'Student not found' : 'Faculty not found',
        errorCode: 'PERSON_NOT_FOUND',
      });
    }

    try {
      const inserted = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO medical_camp_registrations
          (camp_id, student_id, faculty_id, remarks, registered_by_user_id)
        VALUES (
          ${campId},
          ${dto.student_id ?? null}::int,
          ${dto.faculty_id ?? null}::int,
          ${dto.remarks ?? null},
          ${userId}::int
        )
        RETURNING id
      `);
      const registered = await this.syncRegisteredCount(campId);
      this.logger.log(
        `Camp ${campId}: registered ${isStudent ? 'student' : 'faculty'} ` +
          `${dto.student_id ?? dto.faculty_id} (roster now ${registered})`,
      );
      return { id: inserted[0].id, registered_count: registered };
    } catch (err) {
      // The partial unique indexes make a repeat registration a 23505.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2010' || err.code === 'P2002')
      ) {
        throw new ConflictException({
          message: 'That person is already registered for this camp.',
          errorCode: 'ALREADY_REGISTERED',
        });
      }
      const raw = err as { meta?: { code?: string } };
      if (raw?.meta?.code === '23505') {
        throw new ConflictException({
          message: 'That person is already registered for this camp.',
          errorCode: 'ALREADY_REGISTERED',
        });
      }
      this.logger.error(`DB error registering a person for camp ${campId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /me/medical-centre-camps/:id/registrations/:registrationId
   *
   * Only the remarks are editable. Which person a row refers to is not: a
   * mis-registered person is removed and the right one added, so the roster
   * keeps an honest registered_at for each attendee.
   */
  async update(
    campId: number,
    registrationId: number,
    dto: UpdateCampRegistrationDto,
  ) {
    await this.assertCampExists(campId);
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE medical_camp_registrations
           SET remarks = ${dto.remarks ?? null}
         WHERE id = ${registrationId} AND camp_id = ${campId}
        RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Registration not found on this camp',
          errorCode: 'REGISTRATION_NOT_FOUND',
        });
      }
      return { id: rows[0].id, message: 'Registration updated' };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error updating registration ${registrationId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/medical-centre-camps/:id/registrations/:registrationId */
  async remove(campId: number, registrationId: number) {
    await this.assertCampExists(campId);
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM medical_camp_registrations
         WHERE id = ${registrationId} AND camp_id = ${campId}
        RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Registration not found on this camp',
          errorCode: 'REGISTRATION_NOT_FOUND',
        });
      }
      const registered = await this.syncRegisteredCount(campId);
      return { id: rows[0].id, registered_count: registered };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error removing registration ${registrationId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /me/medical-centre-camps/:id/registrations/bulk
   *
   * Saves a whole selection in one call — what the Register dialog does when
   * the operator presses Save. People already on the roster are skipped rather
   * than failing the batch, so re-saving a list is safe and the response says
   * exactly what happened.
   */
  async addMany(
    campId: number,
    people: AddCampRegistrationDto[],
    userId: number,
  ) {
    await this.assertCampExists(campId);
    if (people.length === 0) {
      throw new BadRequestException({
        message: 'Select at least one person to register.',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    let added = 0;
    let skipped = 0;
    for (const person of people) {
      const isStudent = person.student_id != null;
      if (isStudent === (person.faculty_id != null)) {
        throw new BadRequestException({
          message: 'Each entry needs exactly one of student_id or faculty_id.',
          errorCode: 'VALIDATION_ERROR',
        });
      }
      try {
        // ON CONFLICT DO NOTHING would need a named constraint; the partial
        // unique indexes are not usable as conflict targets, so an existing
        // person is filtered out by the NOT EXISTS guard instead.
        const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
          INSERT INTO medical_camp_registrations
            (camp_id, student_id, faculty_id, remarks, registered_by_user_id)
          SELECT ${campId},
                 ${person.student_id ?? null}::int,
                 ${person.faculty_id ?? null}::int,
                 ${person.remarks ?? null},
                 ${userId}::int
          WHERE NOT EXISTS (
            SELECT 1 FROM medical_camp_registrations x
             WHERE x.camp_id = ${campId}
               AND x.student_id IS NOT DISTINCT FROM ${person.student_id ?? null}::int
               AND x.faculty_id IS NOT DISTINCT FROM ${person.faculty_id ?? null}::int
          )
          RETURNING id
        `);
        if (rows.length > 0) added += 1;
        else skipped += 1;
      } catch (err) {
        this.logger.error(`DB error in bulk register for camp ${campId}`, err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }

    const registered = await this.syncRegisteredCount(campId);
    this.logger.log(
      `Camp ${campId}: bulk register added ${added}, skipped ${skipped} (roster now ${registered})`,
    );
    return { added, skipped, registered_count: registered };
  }
}
