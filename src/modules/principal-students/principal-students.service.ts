import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

interface DirectoryRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  dept_code: string | null;
  dept_name: string | null;
  semester: number | null;
  class_id: number | null;
  section: string | null;
  present_count: bigint | null;
  total_count: bigint | null;
  cgpa: string | null;
  total_demand: string | null;
  total_paid: string | null;
  has_concession: boolean | null;
}

type FeeStatus = 'paid' | 'due' | 'scholarship' | 'no_demand';

function resolveName(row: { first_name: string | null; last_name: string | null; email: string }): string {
  if (row.first_name) {
    return row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name;
  }
  return row.email;
}

function resolveAttendancePct(row: { present_count: bigint | null; total_count: bigint | null }): number | null {
  const total = Number(row.total_count ?? 0);
  if (total <= 0) return null;
  const present = Number(row.present_count ?? 0);
  return Math.round((present / total) * 1000) / 10;
}

function resolveFeeStatus(row: {
  total_demand: string | null;
  total_paid: string | null;
  has_concession: boolean | null;
}): { status: FeeStatus; outstanding: number } {
  const demand = Number(row.total_demand ?? 0);
  const paid = Number(row.total_paid ?? 0);
  const outstanding = Math.max(demand - paid, 0);
  if (demand <= 0) return { status: 'no_demand', outstanding: 0 };
  if (row.has_concession) return { status: 'scholarship', outstanding };
  if (outstanding <= 0) return { status: 'paid', outstanding: 0 };
  return { status: 'due', outstanding };
}

/**
 * Institution-wide, Principal-only student directory: search/filter across
 * every department, with attendance/CGPA/fee-status computed live from real
 * records (no stored "student summary" table exists to read from instead).
 */
@Injectable()
export class PrincipalStudentsService {
  private readonly logger = new Logger(PrincipalStudentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRollCount(): Promise<number> {
    return this.prisma.students.count();
  }

  async search(dto: ListPrincipalStudentsQueryDto) {
    const limit = dto.limit ?? 20;
    const page = dto.page ?? 1;
    const offset = (page - 1) * limit;

    const filters: Prisma.Sql[] = [];

    if (dto.search && dto.search.trim().length > 0) {
      const term = `%${dto.search.trim()}%`;
      filters.push(Prisma.sql`(
        st.student_id_no ILIKE ${term} OR
        st.roll_no ILIKE ${term} OR
        st.register_no ILIKE ${term} OR
        soa.first_name ILIKE ${term} OR
        soa.last_name ILIKE ${term} OR
        u.email ILIKE ${term}
      )`);
    }
    if (dto.department_id !== undefined) {
      filters.push(Prisma.sql`cl.department_id = ${dto.department_id}`);
    }
    if (dto.class_id !== undefined) {
      filters.push(Prisma.sql`st.class_id = ${dto.class_id}`);
    }
    if (dto.year !== undefined) {
      // No literal "year of study" column exists; derived from current_semester
      // assuming 2 semesters per academic year (institution-wide convention).
      filters.push(Prisma.sql`CEIL(cl.current_semester / 2.0) = ${dto.year}`);
    }
    if (dto.below_75) {
      filters.push(
        Prisma.sql`(sa.total_count IS NOT NULL AND sa.total_count > 0 AND (sa.present_count::numeric / sa.total_count) * 100 < 75)`,
      );
    }
    if (dto.fees_pending) {
      filters.push(
        Prisma.sql`(COALESCE(sf.total_demand, 0) - COALESCE(sf.total_paid, 0)) > 0 AND NOT COALESCE(sf.has_concession, false)`,
      );
    }

    const whereClause = filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    const base = Prisma.sql`
      WITH student_attendance AS (
        SELECT ar.student_id,
          COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
          COUNT(*) AS total_count
        FROM attendance_records ar
        JOIN students st2 ON st2.id = ar.student_id
        JOIN classes cl2 ON cl2.id = st2.class_id
        LEFT JOIN academic_calendars ac ON ac.batch_id = cl2.batch_id AND ac.semester = cl2.current_semester
        WHERE ar.attendance_date <= CURRENT_DATE
          AND (ac.start_date IS NULL OR ar.attendance_date >= ac.start_date)
        GROUP BY ar.student_id
      ),
      student_cgpa AS (
        SELECT em.student_id,
          SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
            / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0) AS cgpa
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        LEFT JOIN LATERAL (
          SELECT grade_point FROM grade_bands gb2
          WHERE gb2.min_percentage <= (em.marks_obtained / NULLIF(em.max_marks, 0) * 100)
          ORDER BY gb2.min_percentage DESC
          LIMIT 1
        ) gb ON true
        WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        GROUP BY em.student_id
      ),
      student_fees AS (
        SELECT sfdm.student_id,
          SUM(sfdm.total_amount) AS total_demand,
          COALESCE(SUM(fp.amount_paid), 0) AS total_paid,
          BOOL_OR(fc.id IS NOT NULL AND fc.is_settled = false) AS has_concession
        FROM student_fee_demand_mapping sfdm
        LEFT JOIN fee_payments fp ON fp.student_fee_demand_mapping_id = sfdm.id
        LEFT JOIN fee_structures fs ON fs.id = sfdm.fee_structure_id
        LEFT JOIN fee_concessions fc ON fc.fee_structure_id = fs.id
        GROUP BY sfdm.student_id
      )
      SELECT
        st.id, st.student_id_no, st.roll_no,
        soa.first_name, soa.last_name, u.email,
        d.code AS dept_code, d.name AS dept_name, cl.current_semester AS semester,
        cl.id AS class_id, cl.section AS section,
        sa.present_count, sa.total_count,
        sc.cgpa::text AS cgpa,
        sf.total_demand::text AS total_demand, sf.total_paid::text AS total_paid, sf.has_concession
      FROM students st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN soa_applications soa ON soa.id = st.soa_application_id
      LEFT JOIN classes cl ON cl.id = st.class_id
      LEFT JOIN departments d ON d.id = cl.department_id
      LEFT JOIN student_attendance sa ON sa.student_id = st.id
      LEFT JOIN student_cgpa sc ON sc.student_id = st.id
      LEFT JOIN student_fees sf ON sf.student_id = st.id
      ${whereClause}
    `;

    try {
      const [rows, countRows] = await Promise.all([
        this.prisma.$queryRaw<DirectoryRow[]>(Prisma.sql`
          ${base}
          ORDER BY st.student_id_no ASC
          LIMIT ${limit} OFFSET ${offset}
        `),
        this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (${base}) sub
        `),
      ]);

      const total = Number(countRows[0]?.count ?? 0);

      return {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
        students: rows.map((row) => {
          const fee = resolveFeeStatus(row);
          return {
            id: row.id,
            student_id_no: row.student_id_no,
            register_no: row.roll_no,
            name: resolveName(row),
            department_code: row.dept_code,
            department_name: row.dept_name,
            semester: row.semester,
            class_id: row.class_id,
            section: row.section,
            attendance_pct: resolveAttendancePct(row),
            cgpa: row.cgpa !== null ? Math.round(Number(row.cgpa) * 100) / 100 : null,
            fee_status: fee.status,
            fee_outstanding: fee.outstanding,
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error searching principal student directory', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getAttendanceOverview() {
    try {
      const [presentTodayRows, semesterAggRows, deptRows] = await Promise.all([
        this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT COUNT(DISTINCT student_id)::bigint AS count
          FROM attendance_records
          WHERE attendance_date = CURRENT_DATE AND status = 'present'
        `),
        this.prisma.$queryRaw<{ mean_pct: string | null; below_75_count: bigint }[]>(Prisma.sql`
          WITH student_attendance AS (
            SELECT ar.student_id,
              COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
              COUNT(*) AS total_count
            FROM attendance_records ar
            JOIN students st ON st.id = ar.student_id
            JOIN classes cl ON cl.id = st.class_id
            LEFT JOIN academic_calendars ac ON ac.batch_id = cl.batch_id AND ac.semester = cl.current_semester
            WHERE ar.attendance_date <= CURRENT_DATE
              AND (ac.start_date IS NULL OR ar.attendance_date >= ac.start_date)
            GROUP BY ar.student_id
          )
          SELECT
            AVG(present_count::numeric / NULLIF(total_count, 0) * 100)::text AS mean_pct,
            COUNT(*) FILTER (WHERE total_count > 0 AND (present_count::numeric / total_count) * 100 < 75)::bigint AS below_75_count
          FROM student_attendance
          WHERE total_count > 0
        `),
        this.prisma.$queryRaw<{ code: string; name: string; pct: string | null }[]>(Prisma.sql`
          WITH student_attendance AS (
            SELECT ar.student_id,
              COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
              COUNT(*) AS total_count
            FROM attendance_records ar
            JOIN students st ON st.id = ar.student_id
            JOIN classes cl ON cl.id = st.class_id
            LEFT JOIN academic_calendars ac ON ac.batch_id = cl.batch_id AND ac.semester = cl.current_semester
            WHERE ar.attendance_date <= CURRENT_DATE
              AND (ac.start_date IS NULL OR ar.attendance_date >= ac.start_date)
            GROUP BY ar.student_id
          )
          SELECT d.code, d.name,
            AVG(sa.present_count::numeric / NULLIF(sa.total_count, 0) * 100)::text AS pct
          FROM student_attendance sa
          JOIN students st ON st.id = sa.student_id
          JOIN classes cl ON cl.id = st.class_id
          JOIN departments d ON d.id = cl.department_id
          WHERE sa.total_count > 0
          GROUP BY d.id, d.code, d.name
          ORDER BY d.name ASC
        `),
      ]);

      return {
        present_today: Number(presentTodayRows[0]?.count ?? 0),
        mean_attendance_pct:
          semesterAggRows[0]?.mean_pct !== null && semesterAggRows[0]?.mean_pct !== undefined
            ? Math.round(Number(semesterAggRows[0].mean_pct) * 10) / 10
            : null,
        below_75_count: Number(semesterAggRows[0]?.below_75_count ?? 0),
        departments: deptRows.map((row) => ({
          code: row.code,
          name: row.name,
          attendance_pct: row.pct !== null ? Math.round(Number(row.pct) * 10) / 10 : null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal attendance overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
