import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { AdmitBedDto } from './dto/admit-bed.dto';

interface BedRow {
  bed_id: number;
  bed_code: string;
  wing: string;
  stay_id: number | null;
  reason: string | null;
  vitals: string | null;
  medication_given: string | null;
  guardian_contacted: boolean | null;
  plan: string | null;
  admitted_at: Date | null;
  expected_review_at: Date | null;
  student_name: string | null;
  faculty_name: string | null;
  dept: string | null;
  roll: string | null;
  staff_name: string | null;
}

function minutesAgo(date: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return `${mins} min`;
}

/** Sick room — sick_room_beds (6 fixed beds) + sick_room_stays (current occupant = discharged_at IS NULL). */
@Injectable()
export class MedicalCentreSickroomService {
  private readonly logger = new Logger(MedicalCentreSickroomService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getBeds() {
    try {
      const rows = await this.prisma.$queryRaw<BedRow[]>(Prisma.sql`
        SELECT b.id AS bed_id, b.bed_code, b.wing,
          st.id AS stay_id, st.reason, st.vitals, st.medication_given, st.guardian_contacted, st.plan, st.admitted_at, st.expected_review_at,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), su.email) AS student_name,
          NULLIF(TRIM(CONCAT(f.first_name, ' ', COALESCE(f.last_name, ''))), '') AS faculty_name,
          d.code AS dept, s.student_id_no AS roll,
          ms.name AS staff_name
        FROM sick_room_beds b
        LEFT JOIN sick_room_stays st ON st.bed_id = b.id AND st.discharged_at IS NULL
        LEFT JOIN medical_visits mv ON mv.id = st.visit_id
        LEFT JOIN students s ON s.id = mv.student_id
        LEFT JOIN users su ON su.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        LEFT JOIN faculty f ON f.id = mv.faculty_id
        LEFT JOIN medical_staff ms ON ms.id = mv.attended_by_staff_id
        ORDER BY b.bed_code ASC
      `);

      return rows.map((r) => ({
        id: r.bed_code,
        bedId: r.bed_id,
        wing: r.wing === 'ladies' ? 'Ladies' : 'Gents',
        occupied: r.stay_id != null,
        name: r.student_name ?? r.faculty_name ?? undefined,
        deptRoll: r.roll ? `${r.roll} · ${r.dept ?? '—'}` : undefined,
        reason: r.reason ?? undefined,
        since: r.admitted_at ? minutesAgo(r.admitted_at) : undefined,
        admitted: r.admitted_at ? r.admitted_at.toISOString() : undefined,
        by: r.staff_name ?? undefined,
        vitals: r.vitals ?? undefined,
        meds: r.medication_given ?? undefined,
        guardian: r.guardian_contacted ? 'Guardian contacted' : 'Not contacted yet',
        plan: r.plan ?? undefined,
        review: r.expected_review_at ? r.expected_review_at.toISOString() : undefined,
      }));
    } catch (err) {
      this.logger.error('DB error listing sick room beds', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async admit(bedId: number, dto: AdmitBedDto) {
    try {
      const bed = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT b.id FROM sick_room_beds b
        LEFT JOIN sick_room_stays st ON st.bed_id = b.id AND st.discharged_at IS NULL
        WHERE b.id = ${bedId} AND st.id IS NULL
      `);
      if (bed.length === 0) {
        throw new BadRequestException({ message: 'This bed is occupied or does not exist', errorCode: 'BED_UNAVAILABLE' });
      }
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO sick_room_stays (bed_id, visit_id, reason, vitals, medication_given, guardian_contacted, plan, expected_review_at)
        VALUES (
          ${bedId}, ${dto.visit_id ?? null}, ${dto.reason ?? null}, ${dto.vitals ?? null}, ${dto.medication_given ?? null},
          ${dto.guardian_contacted ?? false}, ${dto.plan ?? null},
          ${dto.review_in_minutes != null ? Prisma.sql`now() + (${dto.review_in_minutes} || ' minutes')::interval` : Prisma.sql`NULL`}
        )
        RETURNING id
      `);
      return { stayId: rows[0].id };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`DB error admitting to bed ${bedId}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async discharge(bedId: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE sick_room_stays SET discharged_at = now()
        WHERE bed_id = ${bedId} AND discharged_at IS NULL
        RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'This bed is not currently occupied', errorCode: 'BED_NOT_OCCUPIED' });
      }
      return { stayId: rows[0].id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error discharging bed ${bedId}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
