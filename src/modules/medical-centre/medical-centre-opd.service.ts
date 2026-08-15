import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateWalkinDto } from './dto/create-walkin.dto';

type QueueStatus = 'waiting' | 'consult' | 'done';
const NEXT_STATUS: Record<QueueStatus, QueueStatus> = { waiting: 'consult', consult: 'done', done: 'waiting' };

interface QueueRow {
  id: number;
  status: QueueStatus;
  queued_at: Date;
  reason: string | null;
  student_name: string | null;
  student_dept: string | null;
  faculty_name: string | null;
  faculty_dept: string | null;
}

function minutesAgo(date: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return `${mins} min`;
}

/**
 * OPD queue — backed by medical_visits.status/queued_at (added on top of
 * the original visit-record columns). "Waiting" duration is computed live
 * from queued_at rather than stored, so it's always accurate.
 */
@Injectable()
export class MedicalCentreOpdService {
  private readonly logger = new Logger(MedicalCentreOpdService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getQueue(date?: string) {
    try {
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new BadRequestException({ message: 'date must be in YYYY-MM-DD format', errorCode: 'INVALID_DATE' });
      }
      const targetDate = date ?? new Date().toISOString().slice(0, 10);
      const rows = await this.prisma.$queryRaw<QueueRow[]>(Prisma.sql`
        SELECT mv.id, mv.status, mv.queued_at, mv.reason,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), su.email) AS student_name,
          d.code AS student_dept,
          NULLIF(TRIM(CONCAT(f.first_name, ' ', COALESCE(f.last_name, ''))), '') AS faculty_name,
          fd.code AS faculty_dept
        FROM medical_visits mv
        LEFT JOIN students s ON s.id = mv.student_id
        LEFT JOIN users su ON su.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        LEFT JOIN faculty f ON f.id = mv.faculty_id
        LEFT JOIN departments fd ON fd.id = f.department_id
        WHERE mv.visit_date = ${targetDate}::date
        ORDER BY mv.queued_at ASC
      `);

      return rows.map((r) => ({
        id: r.id,
        token: `T-${r.id}`,
        name: r.student_name ?? r.faculty_name ?? 'Unrecorded',
        dept: r.student_name ? (r.student_dept ?? '—') : `Faculty, ${r.faculty_dept ?? '—'}`,
        complaint: r.reason ?? '—',
        wait: r.status === 'waiting' ? minutesAgo(r.queued_at) : '—',
        status: r.status,
      }));
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('DB error listing OPD queue', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async addWalkin(dto: CreateWalkinDto) {
    try {
      const status: QueueStatus = dto.to_queue === false ? 'done' : 'waiting';
      const staffId = dto.attended_by_staff_id ?? null;

      if (dto.visitor_type === 'student') {
        const student = await this.prisma.students.findFirst({
          where: { OR: [{ student_id_no: dto.identifier }, { register_no: dto.identifier }] },
          select: { id: true },
        });
        if (!student) {
          throw new NotFoundException({ message: `No student found matching ${dto.identifier}`, errorCode: 'STUDENT_NOT_FOUND' });
        }
        const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
          INSERT INTO medical_visits (visitor_type, student_id, reason, status, queued_at, attended_by_staff_id)
          VALUES ('student', ${student.id}, ${dto.reason ?? null}, ${status}, now(), ${staffId})
          RETURNING id
        `);
        return { id: rows[0].id };
      }

      const faculty = await this.prisma.faculty.findFirst({
        where: { users: { email: dto.identifier } },
        select: { id: true },
      });
      if (!faculty) {
        throw new NotFoundException({ message: `No faculty found matching ${dto.identifier}`, errorCode: 'FACULTY_NOT_FOUND' });
      }
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO medical_visits (visitor_type, faculty_id, reason, status, queued_at, attended_by_staff_id)
        VALUES ('faculty', ${faculty.id}, ${dto.reason ?? null}, ${status}, now(), ${staffId})
        RETURNING id
      `);
      return { id: rows[0].id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error adding walk-in', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async advance(id: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ status: QueueStatus }[]>(Prisma.sql`SELECT status FROM medical_visits WHERE id = ${id}`);
      const current = rows[0];
      if (!current) {
        throw new NotFoundException({ message: 'Visit not found', errorCode: 'VISIT_NOT_FOUND' });
      }
      const next = NEXT_STATUS[current.status];
      await this.prisma.$executeRaw(Prisma.sql`UPDATE medical_visits SET status = ${next} WHERE id = ${id}`);
      return { id, status: next };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error advancing OPD visit ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
