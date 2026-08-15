import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectHigherEducationSchema } from './higher-education-schema.util';
import type { ListAspirantsQueryDto } from './dto/list-aspirants-query.dto';
import type { CreateAspirantDto } from './dto/create-aspirant.dto';

interface AspirantListRow {
  aspirant_id: number;
  student_id: number;
  preferred_course: string;
  preferred_country: string;
  preferred_university: string | null;
  is_scholarship: boolean | null;
  scholarship_name: string | null;
  admission_status: string | null;
  student_id_no: string;
  student_name: string;
  dept_code: string | null;
  batch_name: string | null;
}

interface AspirantDetailRow extends AspirantListRow {
  register_no: string | null;
  intake_term: string | null;
  scholarship_value: string | null;
  cgpa: string | null;
  percentage: string | null;
  test_scores_summary: string | null;
  offer_status: string | null;
  visa_status: string | null;
  sop_status: string | null;
  recommendation_status: string | null;
  research_output: string | null;
  internship_details: string | null;
  application_submitted_date: Date | null;
  interview_date: Date | null;
  funding_source: string | null;
  remarks: string | null;
  dept_name: string | null;
  student_contact: string | null;
  student_email: string | null;
  father_name: string | null;
  parent_contact: string | null;
  user_email: string;
}

function formatBatchLabel(name: string | null): string | null {
  return name ? name.replace('_', '–') : null;
}

function dash(value: string | null | undefined): string {
  return value == null || value.trim() === '' ? '—' : value;
}

function isAbroad(country: string): boolean {
  return country.trim().toLowerCase() !== 'india';
}

/**
 * Higher Education Cell coordinator's aspirant roster. Backed by
 * `student_higher_education` — see higher-education-dashboard.service.ts for
 * why every column beyond the original preferred_course/preferred_country/
 * preferred_university/remarks goes through $queryRaw.
 */
@Injectable()
export class HigherEducationAspirantsService {
  private readonly logger = new Logger(HigherEducationAspirantsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListAspirantsQueryDto) {
    try {
      const schema = await detectHigherEducationSchema(this.prisma);
      const rows = await this.prisma.$queryRaw<AspirantListRow[]>(Prisma.sql`
        SELECT
          she.id AS aspirant_id, she.student_id, she.preferred_course, she.preferred_country, she.preferred_university,
          she.is_scholarship, she.scholarship_name, she.admission_status::text AS admission_status,
          s.student_id_no,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), u.email) AS student_name,
          d.code AS dept_code, b.name AS batch_name
        FROM student_higher_education she
        JOIN students s ON s.id = she.student_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        LEFT JOIN batches b ON b.id = s.batch_id
        ORDER BY she.created_at DESC
      `);

      const [departments, batches] = await Promise.all([
        this.prisma.departments.findMany({ select: { code: true, name: true }, orderBy: { code: 'asc' } }),
        this.prisma.batches.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      ]);

      const search = query.search?.trim().toLowerCase();
      const filtered = rows.filter((r) => {
        if (query.batch && formatBatchLabel(r.batch_name) !== query.batch) return false;
        if (query.department && r.dept_code !== query.department) return false;
        if (query.status && (r.admission_status ?? 'interested') !== query.status) return false;
        if (!search) return true;
        return [r.student_name, r.student_id_no, r.preferred_university, r.preferred_course, r.preferred_country]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search);
      });

      const abroadRows = rows.filter((r) => isAbroad(r.preferred_country));
      const scholarshipRows = rows.filter((r) => r.is_scholarship);
      const scholarshipNames = Array.from(
        new Set(scholarshipRows.map((r) => r.scholarship_name).filter((n): n is string => !!n && n.trim() !== '')),
      );

      return {
        extended: schema.extended,
        meta: { total: rows.length, filtered: filtered.length },
        summary: {
          total: rows.length,
          withinIndia: rows.length - abroadRows.length,
          abroad: abroadRows.length,
          countriesAbroad: new Set(abroadRows.map((r) => r.preferred_country)).size,
          admittedCount: rows.filter((r) => r.admission_status === 'admitted' || r.admission_status === 'enrolled').length,
          scholarshipCount: scholarshipRows.length,
          scholarshipNames,
        },
        filters: {
          departments: departments.map((d) => d.code),
          batches: batches.map((b) => formatBatchLabel(b.name)).filter((b): b is string => !!b),
        },
        rows: filtered.map((r) => ({
          aspirant_id: r.aspirant_id,
          student_name: r.student_name,
          student_id_no: r.student_id_no,
          dept_batch: `${dash(r.dept_code)} · ${dash(formatBatchLabel(r.batch_name))}`,
          programme: r.preferred_course,
          university: dash(r.preferred_university),
          country: r.preferred_country,
          scholarship: r.is_scholarship ? dash(r.scholarship_name) : 'Not availed',
          status: r.admission_status ?? 'interested',
        })),
      };
    } catch (err) {
      this.logger.error('DB error listing higher-education aspirants', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    try {
      const schema = await detectHigherEducationSchema(this.prisma);
      const academicsSelect = schema.academics
        ? Prisma.sql`she.cgpa::text AS cgpa, she.percentage::text AS percentage, she.test_scores_summary,`
        : Prisma.sql`NULL::text AS cgpa, NULL::text AS percentage, NULL::varchar AS test_scores_summary,`;

      const rows = await this.prisma.$queryRaw<AspirantDetailRow[]>(Prisma.sql`
        SELECT
          she.id AS aspirant_id, she.student_id, she.preferred_course, she.preferred_country, she.preferred_university,
          she.remarks, she.is_scholarship, she.scholarship_name, she.scholarship_value::text AS scholarship_value,
          she.admission_status::text AS admission_status, she.offer_status::text AS offer_status, she.visa_status::text AS visa_status,
          she.intake_term, she.sop_status, she.recommendation_status, she.research_output, she.internship_details,
          ${academicsSelect}
          she.application_submitted_date, she.interview_date, she.funding_source,
          s.student_id_no, s.register_no,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), u.email) AS student_name,
          d.code AS dept_code, d.name AS dept_name, b.name AS batch_name,
          sa.student_contact, sa.student_email, sa.father_name, sa.parent_contact,
          u.email AS user_email
        FROM student_higher_education she
        JOIN students s ON s.id = she.student_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        LEFT JOIN batches b ON b.id = s.batch_id
        WHERE she.id = ${id}
      `);

      const row = rows[0];
      if (!row) {
        throw new NotFoundException({ message: 'Aspirant record not found', errorCode: 'ASPIRANT_NOT_FOUND' });
      }

      const testScores = await this.prisma.student_test_scores.findMany({
        where: { student_id: row.student_id },
        select: { test_name: true, score: true, test_date: true },
        orderBy: { test_date: 'desc' },
      });

      return {
        aspirant_id: row.aspirant_id,
        student_name: row.student_name,
        student_id_no: row.student_id_no,
        register_no: row.register_no,
        dept_code: row.dept_code,
        dept_name: row.dept_name,
        batch: formatBatchLabel(row.batch_name),
        mode: isAbroad(row.preferred_country) ? 'Abroad' : 'Within India',
        status: row.admission_status ?? 'interested',
        intake: row.intake_term,
        programme: {
          course: row.preferred_course,
          university: dash(row.preferred_university),
          country: row.preferred_country,
          intake: dash(row.intake_term),
          sop_status: dash(row.sop_status),
          recommendation_status: dash(row.recommendation_status),
        },
        academics: {
          cgpa: row.cgpa != null ? Number(row.cgpa) : null,
          percentage: row.percentage != null ? Number(row.percentage) : null,
          test_scores_summary: dash(row.test_scores_summary),
        },
        readiness: {
          research_output: dash(row.research_output),
          internship_details: dash(row.internship_details),
          visa_status: dash(row.visa_status),
        },
        testScores: testScores.map((t) => ({ test_name: t.test_name, score: Number(t.score), test_date: t.test_date })),
        timeline: {
          application_submitted_date: row.application_submitted_date,
          interview_date: row.interview_date,
          offer_status: dash(row.offer_status),
        },
        funding: {
          is_scholarship: !!row.is_scholarship,
          scholarship_name: row.is_scholarship ? dash(row.scholarship_name) : 'Not availed',
          scholarship_value: row.scholarship_value != null ? Number(row.scholarship_value) : null,
          funding_source: dash(row.funding_source),
          student_contact: dash(row.student_contact),
          email: row.student_email ?? row.user_email,
          guardian: row.father_name || row.parent_contact ? `${dash(row.father_name)} · ${dash(row.parent_contact)}` : '—',
        },
        remarks: dash(row.remarks),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error fetching higher-education aspirant ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /me/higher-education-aspirants — the coordinator identifies the
   * student by their real register number (student_higher_education has no
   * "name" field of its own to type in). student_id is unique, so this is
   * an upsert: adding a student who's already on the roster just updates
   * their existing higher-education file rather than erroring.
   */
  async createAspirant(dto: CreateAspirantDto) {
    try {
      const student = await this.prisma.students.findFirst({
        where: { register_no: dto.register_no },
        select: { id: true },
      });
      if (!student) {
        throw new NotFoundException({
          message: `No student found with register number ${dto.register_no}`,
          errorCode: 'STUDENT_NOT_FOUND',
        });
      }

      const isScholarship = !!(dto.scholarship_name?.trim() || dto.scholarship_value != null);
      const schema = await detectHigherEducationSchema(this.prisma);

      const academicsColumns = schema.academics ? Prisma.sql`, cgpa, percentage, test_scores_summary` : Prisma.empty;
      const academicsValues = schema.academics
        ? Prisma.sql`, ${dto.cgpa ?? null}, ${dto.percentage ?? null}, ${dto.test_scores_summary ?? null}`
        : Prisma.empty;
      const academicsUpdate = schema.academics
        ? Prisma.sql`cgpa = EXCLUDED.cgpa, percentage = EXCLUDED.percentage, test_scores_summary = EXCLUDED.test_scores_summary,`
        : Prisma.empty;

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO student_higher_education (
          student_id, preferred_course, preferred_country, preferred_university, intake_term,
          is_scholarship, scholarship_name, scholarship_value, admission_status${academicsColumns}
        )
        VALUES (
          ${student.id}, ${dto.programme}, ${dto.country}, ${dto.university ?? null}, ${dto.intake ?? null},
          ${isScholarship}, ${dto.scholarship_name ?? null}, ${dto.scholarship_value ?? null},
          ${(dto.stage ?? 'interested') as unknown as string}::higher_education_admission_status_enum${academicsValues}
        )
        ON CONFLICT (student_id) DO UPDATE SET
          preferred_course = EXCLUDED.preferred_course,
          preferred_country = EXCLUDED.preferred_country,
          preferred_university = EXCLUDED.preferred_university,
          intake_term = EXCLUDED.intake_term,
          ${academicsUpdate}
          is_scholarship = EXCLUDED.is_scholarship,
          scholarship_name = EXCLUDED.scholarship_name,
          scholarship_value = EXCLUDED.scholarship_value,
          admission_status = EXCLUDED.admission_status
        RETURNING id
      `);

      return { aspirant_id: rows[0].id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error creating higher-education aspirant', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
