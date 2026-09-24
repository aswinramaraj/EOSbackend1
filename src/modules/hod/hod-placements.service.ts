import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { buildMultiWordNameSql } from 'src/common/utils/name-search.util';
import { isUndefinedColumnError } from 'src/common/utils/pg-error.util';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

interface StudentRow {
  student_id: number;
  student_id_no: string;
  first_name: string;
  last_name: string | null;
  class_id: number;
  section: string;
  current_semester: number | null;
  status: string | null;
  company_name: string | null;
  offered_package: string | null;
  offers: bigint;
}

interface BatchAggRow {
  batch_id: number;
  eligible: bigint;
  placed: bigint;
  avg_package: string | null;
}

interface TopRecruiterRow {
  batch_id: number;
  company_name: string;
  offers: bigint;
}

interface InternshipDriveRow {
  id: number;
  job_role: string | null;
  stipend_amount: string | null;
  duration_months: number | null;
  scheduled_date: Date;
  registration_start: Date | null;
  registration_end: Date | null;
  status: string;
  company_name: string;
}

interface InternshipStudentRow {
  student_id: number;
  student_id_no: string;
  first_name: string;
  last_name: string | null;
  class_id: number;
  section: string;
  current_semester: number | null;
  status: string | null;
  company_name: string | null;
  stipend_amount: string | null;
  offers: bigint;
}

/**
 * GET /hod/placements/drives|students|history — department-scoped
 * placement data, extending HodService's own dept-scoped placements query
 * and PrincipalPlacementsService's batch/season rollup pattern. Real
 * tables only: `placement_drives`, `companies`, `student_drive_applications`,
 * `students`/`classes`/`batches`. Every query sequential (Supabase's
 * session-mode pool caps at 15 connections).
 */
@Injectable()
export class HodPlacementsService {
  private readonly logger = new Logger(HodPlacementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  /**
   * `drive_type` is real once internship_drive_type.query.md runs — returns
   * an empty set (no filtering) until then. Used to exclude internship
   * drives from this full-time-placement view (Internships gets its own
   * dedicated HoD view) via `id: { notIn: [...] }`, since `drive_type`
   * itself isn't in the Prisma Client's generated types yet.
   */
  private async internshipDriveIds(): Promise<Set<number>> {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM placement_drives WHERE drive_type = 'internship'
      `;
      return new Set(rows.map((r) => r.id));
    } catch {
      return new Set();
    }
  }

  /** Upcoming drives are institution-wide (a drive isn't department-specific — any eligible student from any department can apply), matching how placement_drives has no department_id column. */
  async getDrives() {
    try {
      const internshipIds = await this.internshipDriveIds();
      const drives = await this.prisma.placement_drives.findMany({
        where: {
          scheduled_date: {
            gte: new Date(new Date().toISOString().slice(0, 10)),
          },
          id:
            internshipIds.size > 0 ? { notIn: [...internshipIds] } : undefined,
        },
        orderBy: { scheduled_date: 'asc' },
        select: {
          id: true,
          job_role: true,
          package_lpa: true,
          eligibility_cgpa: true,
          scheduled_date: true,
          registration_start: true,
          registration_end: true,
          status: true,
          companies: { select: { name: true } },
        },
      });
      return drives.map((d) => ({
        id: d.id,
        company_name: d.companies.name,
        job_role: d.job_role,
        package_lpa: d.package_lpa != null ? Number(d.package_lpa) : null,
        eligibility_cgpa:
          d.eligibility_cgpa != null ? Number(d.eligibility_cgpa) : null,
        scheduled_date: toDateOnly(d.scheduled_date)!,
        registration_start: toDateOnly(d.registration_start),
        registration_end: toDateOnly(d.registration_end),
        status: d.status,
      }));
    } catch (err) {
      this.logger.error('DB error listing HoD placement drives', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hod/internships/drives — institution-wide upcoming internship
   * drives (same "not department-specific" reasoning as getDrives() above).
   * Real once internship_drive_type.query.md runs; empty array until then.
   */
  async getInternshipDrives() {
    try {
      const rows = await this.prisma.$queryRaw<InternshipDriveRow[]>`
        SELECT pd.id, pd.job_role, pd.stipend_amount::text AS stipend_amount, pd.duration_months,
          pd.scheduled_date, pd.registration_start, pd.registration_end, pd.status,
          c.name AS company_name
        FROM placement_drives pd
        JOIN companies c ON c.id = pd.company_id
        WHERE pd.drive_type = 'internship' AND pd.scheduled_date >= CURRENT_DATE
        ORDER BY pd.scheduled_date ASC
      `;
      return rows.map((d) => ({
        id: d.id,
        company_name: d.company_name,
        job_role: d.job_role,
        stipend_amount:
          d.stipend_amount != null ? Number(d.stipend_amount) : null,
        duration_months: d.duration_months,
        scheduled_date: toDateOnly(d.scheduled_date)!,
        registration_start: toDateOnly(d.registration_start),
        registration_end: toDateOnly(d.registration_end),
        status: d.status,
      }));
    } catch (err) {
      if (isUndefinedColumnError(err, 'drive_type')) return [];
      this.logger.error('DB error listing HoD internship drives', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hod/internships/students — department-scoped internship roster,
   * mirroring getStudents() but for drive_type='internship' only. Real
   * once internship_drive_type.query.md runs; empty roster (not an error)
   * until then.
   */
  async getInternshipStudents(
    user: JwtPayload,
    search?: string,
    classId?: number,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true, code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true, section: true, current_semester: true },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });

      const nameSql = buildMultiWordNameSql(
        search,
        Prisma.raw('soa.first_name'),
        Prisma.raw('soa.last_name'),
      );
      const searchClause = !search
        ? Prisma.empty
        : nameSql === Prisma.empty
          ? Prisma.sql`AND st.student_id_no ILIKE ${`%${search}%`}`
          : Prisma.sql`AND (${nameSql} OR st.student_id_no ILIKE ${`%${search}%`})`;
      const classClause = classId
        ? Prisma.sql`AND st.class_id = ${classId}`
        : Prisma.empty;

      let rows: InternshipStudentRow[];
      try {
        rows = await this.prisma.$queryRaw<InternshipStudentRow[]>(Prisma.sql`
          WITH best_app AS (
            SELECT DISTINCT ON (sda.student_id) sda.student_id, sda.status,
              pd.stipend_amount::text AS stipend_amount, c.name AS company_name
            FROM student_drive_applications sda
            JOIN placement_drives pd ON pd.id = sda.drive_id
            JOIN companies c ON c.id = pd.company_id
            WHERE pd.drive_type = 'internship'
            ORDER BY sda.student_id, (sda.status = 'placed') DESC, sda.updated_at DESC
          ),
          offer_counts AS (
            SELECT sda.student_id, COUNT(*) FILTER (WHERE sda.status = 'placed')::bigint AS offers
            FROM student_drive_applications sda
            JOIN placement_drives pd ON pd.id = sda.drive_id
            WHERE pd.drive_type = 'internship'
            GROUP BY sda.student_id
          )
          SELECT st.id AS student_id, st.student_id_no, soa.first_name, soa.last_name,
            st.class_id, cl.section, cl.current_semester,
            ba.status, ba.company_name, ba.stipend_amount,
            COALESCE(oc.offers, 0)::bigint AS offers
          FROM students st
          JOIN classes cl ON cl.id = st.class_id
          LEFT JOIN soa_applications soa ON soa.id = st.soa_application_id
          LEFT JOIN best_app ba ON ba.student_id = st.id
          LEFT JOIN offer_counts oc ON oc.student_id = st.id
          WHERE cl.department_id = ${departmentId} AND st.status = 'active'
          ${classClause} ${searchClause}
          ORDER BY st.student_id_no ASC
        `);
      } catch (err) {
        if (!isUndefinedColumnError(err, 'drive_type')) throw err;
        rows = [];
      }

      let placed = 0;
      let inProcess = 0;
      let unplaced = 0;
      const outRows = rows.map((r) => {
        const status: 'placed' | 'in_process' | 'unplaced' =
          r.status === 'placed'
            ? 'placed'
            : r.status != null && r.status !== 'rejected'
              ? 'in_process'
              : 'unplaced';
        if (status === 'placed') placed++;
        else if (status === 'in_process') inProcess++;
        else unplaced++;
        return {
          student_id: r.student_id,
          student_id_no: r.student_id_no,
          name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || null,
          class_label: `${yearLabel(r.current_semester)}-${r.section}`,
          company: r.company_name,
          stipend_amount:
            status === 'placed' && r.stipend_amount != null
              ? Number(r.stipend_amount)
              : null,
          offers: Number(r.offers),
          status,
        };
      });

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        classes: classes.map((c) => ({
          class_id: c.id,
          section: c.section,
          semester: c.current_semester ?? 0,
          year_label: yearLabel(c.current_semester),
          class_label: `${yearLabel(c.current_semester)}-${c.section}`,
        })),
        selected_class_id: classId ?? null,
        counts: { placed, in_process: inProcess, unplaced },
        rows: outRows,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error listing HoD internship students', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getStudents(user: JwtPayload, search?: string, classId?: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true, code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true, section: true, current_semester: true },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });

      // Each word must independently match first/last name (order-
      // independent — "Malar Sekar" and "Sekar Malar" both match
      // first_name="Malar", last_name="Sekar"); student_id_no is a single
      // token, matched against the whole raw search string.
      const nameSql = buildMultiWordNameSql(
        search,
        Prisma.raw('soa.first_name'),
        Prisma.raw('soa.last_name'),
      );
      const searchClause = !search
        ? Prisma.empty
        : nameSql === Prisma.empty
          ? Prisma.sql`AND st.student_id_no ILIKE ${`%${search}%`}`
          : Prisma.sql`AND (${nameSql} OR st.student_id_no ILIKE ${`%${search}%`})`;
      const classClause = classId
        ? Prisma.sql`AND st.class_id = ${classId}`
        : Prisma.empty;
      const internshipIds = await this.internshipDriveIds();
      const internshipFilter =
        internshipIds.size > 0
          ? Prisma.sql`AND pd.id NOT IN (${Prisma.join([...internshipIds])})`
          : Prisma.empty;

      // One row per student's BEST application (placed wins over anything
      // else; otherwise the most recently updated application) — a student
      // can apply to many drives, but the roster only needs one status per
      // student. Full-time only — internship drives excluded once
      // drive_type exists (Internships gets its own dedicated view).
      const rows = await this.prisma.$queryRaw<StudentRow[]>(Prisma.sql`
        WITH best_app AS (
          SELECT DISTINCT ON (sda.student_id) sda.student_id, sda.status, sda.offered_package,
            c.name AS company_name
          FROM student_drive_applications sda
          JOIN placement_drives pd ON pd.id = sda.drive_id
          JOIN companies c ON c.id = pd.company_id
          WHERE 1=1 ${internshipFilter}
          ORDER BY sda.student_id, (sda.status = 'placed') DESC, sda.updated_at DESC
        ),
        offer_counts AS (
          SELECT sda.student_id, COUNT(*) FILTER (WHERE sda.status = 'placed')::bigint AS offers
          FROM student_drive_applications sda
          JOIN placement_drives pd ON pd.id = sda.drive_id
          WHERE 1=1 ${internshipFilter}
          GROUP BY sda.student_id
        )
        SELECT st.id AS student_id, st.student_id_no, soa.first_name, soa.last_name,
          st.class_id, cl.section, cl.current_semester,
          ba.status, ba.company_name, ba.offered_package::text AS offered_package,
          COALESCE(oc.offers, 0)::bigint AS offers
        FROM students st
        JOIN classes cl ON cl.id = st.class_id
        LEFT JOIN soa_applications soa ON soa.id = st.soa_application_id
        LEFT JOIN best_app ba ON ba.student_id = st.id
        LEFT JOIN offer_counts oc ON oc.student_id = st.id
        WHERE cl.department_id = ${departmentId} AND st.status = 'active'
        ${classClause} ${searchClause}
        ORDER BY st.student_id_no ASC
      `);

      let placed = 0;
      let inProcess = 0;
      let unplaced = 0;
      const outRows = rows.map((r) => {
        const status: 'placed' | 'in_process' | 'unplaced' =
          r.status === 'placed'
            ? 'placed'
            : r.status != null && r.status !== 'rejected'
              ? 'in_process'
              : 'unplaced';
        if (status === 'placed') placed++;
        else if (status === 'in_process') inProcess++;
        else unplaced++;
        return {
          student_id: r.student_id,
          student_id_no: r.student_id_no,
          name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || null,
          class_label: `${yearLabel(r.current_semester)}-${r.section}`,
          // Real for any student with an application (placed, in-process,
          // or rejected) — only genuinely-unplaced students (no application
          // at all) have a null company_name from the underlying query.
          company: r.company_name,
          package_lpa:
            status === 'placed' && r.offered_package != null
              ? Number(r.offered_package)
              : null,
          offers: Number(r.offers),
          status,
        };
      });

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        classes: classes.map((c) => ({
          class_id: c.id,
          section: c.section,
          semester: c.current_semester ?? 0,
          year_label: yearLabel(c.current_semester),
          class_label: `${yearLabel(c.current_semester)}-${c.section}`,
        })),
        selected_class_id: classId ?? null,
        counts: { placed, in_process: inProcess, unplaced },
        rows: outRows,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error listing HoD placement students', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** History grouped by batch (graduating cohort) rather than calendar year — a department's own multi-year placement track record. */
  async getHistory(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const batches = await this.prisma.batches.findMany({
        where: { classes: { some: { department_id: departmentId } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      if (batches.length === 0) {
        return { department: { code: department.code }, rows: [] };
      }
      const batchIds = batches.map((b) => b.id);
      const internshipIds = await this.internshipDriveIds();
      const internshipFilter =
        internshipIds.size > 0
          ? Prisma.sql`AND pd.id NOT IN (${Prisma.join([...internshipIds])})`
          : Prisma.empty;
      const placedInternshipFilter =
        internshipIds.size > 0
          ? Prisma.sql`AND sda.drive_id NOT IN (${Prisma.join([...internshipIds])})`
          : Prisma.empty;

      // Full-time placement history only — internship completions excluded
      // from "placed"/avg_package once drive_type exists (Internships gets
      // its own dedicated history view).
      const aggRows = await this.prisma.$queryRaw<BatchAggRow[]>(Prisma.sql`
        WITH dept_students AS (
          SELECT st.id AS student_id, cl.batch_id
          FROM students st JOIN classes cl ON cl.id = st.class_id
          WHERE cl.department_id = ${departmentId} AND cl.batch_id IN (${Prisma.join(batchIds)})
        )
        SELECT ds.batch_id,
          COUNT(DISTINCT ds.student_id)::bigint AS eligible,
          COUNT(DISTINCT sda.student_id) FILTER (WHERE sda.status = 'placed' ${placedInternshipFilter})::bigint AS placed,
          AVG(sda.offered_package) FILTER (WHERE sda.status = 'placed' ${placedInternshipFilter})::text AS avg_package
        FROM dept_students ds
        LEFT JOIN student_drive_applications sda ON sda.student_id = ds.student_id
        GROUP BY ds.batch_id
      `);

      const topRecruiterRows = await this.prisma.$queryRaw<
        TopRecruiterRow[]
      >(Prisma.sql`
        WITH dept_students AS (
          SELECT st.id AS student_id, cl.batch_id
          FROM students st JOIN classes cl ON cl.id = st.class_id
          WHERE cl.department_id = ${departmentId} AND cl.batch_id IN (${Prisma.join(batchIds)})
        ),
        recruiter_counts AS (
          SELECT ds.batch_id, c.name AS company_name, COUNT(*)::bigint AS offers
          FROM student_drive_applications sda
          JOIN placement_drives pd ON pd.id = sda.drive_id
          JOIN companies c ON c.id = pd.company_id
          JOIN dept_students ds ON ds.student_id = sda.student_id
          WHERE sda.status = 'placed'
          ${internshipFilter}
          GROUP BY ds.batch_id, c.name
        )
        SELECT DISTINCT ON (batch_id) batch_id, company_name, offers
        FROM recruiter_counts
        ORDER BY batch_id, offers DESC
      `);

      const aggByBatch = new Map(aggRows.map((r) => [r.batch_id, r]));
      const topByBatch = new Map(topRecruiterRows.map((r) => [r.batch_id, r]));

      return {
        department: { code: department.code },
        rows: batches.map((b) => {
          const agg = aggByBatch.get(b.id);
          const eligible = Number(agg?.eligible ?? 0);
          const placed = Number(agg?.placed ?? 0);
          const top = topByBatch.get(b.id);
          return {
            batch_id: b.id,
            batch_label: b.name,
            eligible_count: eligible,
            placed_count: placed,
            placement_percent:
              eligible > 0 ? Math.round((placed / eligible) * 1000) / 10 : 0,
            average_package_lpa:
              agg?.avg_package != null
                ? Math.round(Number(agg.avg_package) * 100) / 100
                : null,
            top_recruiter: top
              ? { name: top.company_name, offers: Number(top.offers) }
              : null,
          };
        }),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD placement history', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
