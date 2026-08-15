import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { UpsertHealthRecordDto } from './dto/upsert-health-record.dto';

interface RecordRow {
  student_id: number;
  name: string;
  roll: string;
  dept: string | null;
  semester: number | null;
  duration_years: number | null;
  blood_group: string | null;
  allergies: string | null;
  chronic_condition: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  last_visit: Date | null;
  visit_count: bigint;
  stay_count: bigint;
}

function romanYear(semester: number | null, durationYears: number | null): string {
  if (!semester) return '—';
  const year = Math.ceil(semester / 2);
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  return roman[year - 1] ?? String(year);
}

function dash(value: string | null | undefined): string {
  return value == null || value.trim() === '' ? 'None' : value;
}

/**
 * Student health records — backed by student_health_records (new table;
 * blood group/allergies/chronic condition declared at admission), joined
 * with real medical_visits/sick_room_stays for visit counts and stay
 * history.
 */
@Injectable()
export class MedicalCentreRecordsService {
  private readonly logger = new Logger(MedicalCentreRecordsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    try {
      const rows = await this.prisma.$queryRaw<RecordRow[]>(Prisma.sql`
        SELECT
          s.id AS student_id, s.student_id_no AS roll,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), u.email) AS name,
          d.code AS dept, c.current_semester AS semester, co.duration_years,
          shr.blood_group, shr.allergies, shr.chronic_condition, shr.guardian_name, shr.guardian_phone,
          (SELECT max(visit_date) FROM medical_visits mv WHERE mv.student_id = s.id) AS last_visit,
          (SELECT count(*) FROM medical_visits mv WHERE mv.student_id = s.id) AS visit_count,
          (SELECT count(*) FROM sick_room_stays st JOIN medical_visits mv2 ON mv2.id = st.visit_id WHERE mv2.student_id = s.id) AS stay_count
        FROM students s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        LEFT JOIN courses co ON co.id = s.course_id
        LEFT JOIN student_health_records shr ON shr.student_id = s.id
        WHERE EXISTS (SELECT 1 FROM medical_visits mv3 WHERE mv3.student_id = s.id) OR shr.id IS NOT NULL
        ORDER BY name ASC
      `);

      return rows.map((r) => ({
        studentId: r.student_id,
        name: r.name,
        roll: r.roll,
        dept: r.dept ?? '—',
        year: romanYear(r.semester, r.duration_years),
        blood: dash(r.blood_group),
        allergy: dash(r.allergies),
        condition: dash(r.chronic_condition),
        last: r.last_visit ? r.last_visit.toISOString().slice(0, 10) : '—',
        visits: Number(r.visit_count),
        guardian: r.guardian_name ? `${r.guardian_name}${r.guardian_phone ? ` · ${r.guardian_phone}` : ''}` : '—',
        stay: Number(r.stay_count) > 0 ? `Observed ${r.stay_count} time${Number(r.stay_count) === 1 ? '' : 's'}` : 'No overnight stays',
      }));
    } catch (err) {
      this.logger.error('DB error listing health records', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async upsert(studentId: number, dto: UpsertHealthRecordDto) {
    try {
      const student = await this.prisma.students.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) {
        throw new NotFoundException({ message: 'Student not found', errorCode: 'STUDENT_NOT_FOUND' });
      }
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO student_health_records (student_id, blood_group, allergies, chronic_condition, guardian_name, guardian_phone)
        VALUES (${studentId}, ${dto.blood_group ?? null}, ${dto.allergies ?? null}, ${dto.chronic_condition ?? null}, ${dto.guardian_name ?? null}, ${dto.guardian_phone ?? null})
        ON CONFLICT (student_id) DO UPDATE SET
          blood_group = EXCLUDED.blood_group,
          allergies = EXCLUDED.allergies,
          chronic_condition = EXCLUDED.chronic_condition,
          guardian_name = EXCLUDED.guardian_name,
          guardian_phone = EXCLUDED.guardian_phone
      `);
      return { studentId };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error upserting health record for student ${studentId}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
