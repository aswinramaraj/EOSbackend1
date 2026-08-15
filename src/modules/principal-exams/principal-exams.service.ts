import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

// Shared LATERAL join picking the highest grade_bands.min_percentage bracket
// at or below a paper's percentage - same bracket-lookup pattern used by the
// Students directory's CGPA computation. is_absent counts as the lowest
// (failing) bracket rather than joining nothing.
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC
    LIMIT 1
  ) gb ON true
`;

interface SemesterRow {
  semester: number;
}
interface PassRow {
  current_passed: bigint;
  current_total: bigint;
  previous_passed: bigint;
  previous_total: bigint;
}
interface ArrearsRow {
  students_with_arrears: bigint;
  arrear_papers: bigint;
}
interface CgpaRow {
  total_students: bigint;
  high_cgpa_count: bigint;
}
interface RevaluationRow {
  total: bigint;
  pending: bigint;
}
interface DeptPassRow {
  department_id: number;
  passed: bigint;
  total: bigint;
}
interface DeptArrearsRow {
  department_id: number;
  arrear_papers: bigint;
}
interface DeptTopperRow {
  department_id: number;
  topper_cgpa: string | null;
}

/**
 * Principal-only exams & results overview. "Arrear" = a (student, subject)
 * pair that has never had a passing attempt across any results_published
 * exam - there's no stored "arrears" table, so this is derived the same way
 * a real transcript would define it (not just the latest attempt). Pass
 * percentage is scoped to the most recently held exam semester so the
 * "vs last sem" delta is comparing like with like.
 */
@Injectable()
export class PrincipalExamsService {
  private readonly logger = new Logger(PrincipalExamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const semesterRows = await this.prisma.$queryRaw<SemesterRow[]>(Prisma.sql`
        SELECT DISTINCT semester FROM exams WHERE status = 'results_published' ORDER BY semester DESC LIMIT 2
      `);
      const currentSemester = semesterRows[0]?.semester ?? null;
      const previousSemester = semesterRows[1]?.semester ?? null;

      const passRows =
        currentSemester === null
          ? []
          : await this.prisma.$queryRaw<PassRow[]>(Prisma.sql`
              WITH graded AS (
                SELECT em.id, e.semester, gb.is_pass
                FROM exam_marks em
                JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
                JOIN exams e ON e.id = esm.exam_id
                ${GRADE_LOOKUP}
                WHERE e.status = 'results_published' AND e.semester IN (${currentSemester}, ${previousSemester ?? -1})
              )
              SELECT
                COUNT(*) FILTER (WHERE semester = ${currentSemester} AND is_pass)::bigint AS current_passed,
                COUNT(*) FILTER (WHERE semester = ${currentSemester})::bigint AS current_total,
                COUNT(*) FILTER (WHERE semester = ${previousSemester ?? -1} AND is_pass)::bigint AS previous_passed,
                COUNT(*) FILTER (WHERE semester = ${previousSemester ?? -1})::bigint AS previous_total
              FROM graded
            `);

      const arrearsRows = await this.prisma.$queryRaw<ArrearsRow[]>(Prisma.sql`
        WITH subject_attempts AS (
          SELECT em.student_id, esm.subject_id,
            BOOL_OR(gb.is_pass) AS ever_passed
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published'
          GROUP BY em.student_id, esm.subject_id
        )
        SELECT
          COUNT(DISTINCT student_id) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS students_with_arrears,
          COUNT(*) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS arrear_papers
        FROM subject_attempts
      `);

      const cgpaRows = await this.prisma.$queryRaw<CgpaRow[]>(Prisma.sql`
        WITH student_cgpa AS (
          SELECT em.student_id,
            SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
              / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0) AS cgpa
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN subjects sub ON sub.id = esm.subject_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
          GROUP BY em.student_id
        )
        SELECT
          (SELECT COUNT(*) FROM students)::bigint AS total_students,
          COUNT(*) FILTER (WHERE cgpa > 8.5)::bigint AS high_cgpa_count
        FROM student_cgpa
      `);

      const revaluationRows = await this.prisma.$queryRaw<RevaluationRow[]>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status IN ('requested', 'under_review'))::bigint AS pending
        FROM revaluation_requests
      `);

      const deptPassRows =
        currentSemester === null
          ? []
          : await this.prisma.$queryRaw<DeptPassRow[]>(Prisma.sql`
              SELECT cl.department_id,
                COUNT(*) FILTER (WHERE gb.is_pass)::bigint AS passed,
                COUNT(*)::bigint AS total
              FROM exam_marks em
              JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
              JOIN exams e ON e.id = esm.exam_id
              JOIN students st ON st.id = em.student_id
              JOIN classes cl ON cl.id = st.class_id
              ${GRADE_LOOKUP}
              WHERE e.status = 'results_published' AND e.semester = ${currentSemester}
              GROUP BY cl.department_id
            `);

      const deptArrearsRows = await this.prisma.$queryRaw<DeptArrearsRow[]>(Prisma.sql`
        WITH subject_attempts AS (
          SELECT em.student_id, esm.subject_id, st.class_id,
            BOOL_OR(gb.is_pass) AS ever_passed
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN students st ON st.id = em.student_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published'
          GROUP BY em.student_id, esm.subject_id, st.class_id
        )
        SELECT cl.department_id, COUNT(*)::bigint AS arrear_papers
        FROM subject_attempts sa
        JOIN classes cl ON cl.id = sa.class_id
        WHERE sa.ever_passed IS NOT TRUE
        GROUP BY cl.department_id
      `);

      const deptTopperRows = await this.prisma.$queryRaw<DeptTopperRow[]>(Prisma.sql`
        WITH student_cgpa AS (
          SELECT em.student_id, st.class_id,
            SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
              / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0) AS cgpa
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN subjects sub ON sub.id = esm.subject_id
          JOIN students st ON st.id = em.student_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
          GROUP BY em.student_id, st.class_id
        )
        SELECT cl.department_id, MAX(sc.cgpa)::text AS topper_cgpa
        FROM student_cgpa sc
        JOIN classes cl ON cl.id = sc.class_id
        GROUP BY cl.department_id
      `);

      const departments = await this.prisma.departments.findMany({ orderBy: { name: 'asc' } });

      const pass = passRows[0];
      const arrears = arrearsRows[0];
      const cgpa = cgpaRows[0];
      const revaluation = revaluationRows[0];

      const currentPassPct =
        pass && Number(pass.current_total) > 0
          ? Math.round((Number(pass.current_passed) / Number(pass.current_total)) * 1000) / 10
          : null;
      const previousPassPct =
        pass && Number(pass.previous_total) > 0
          ? Math.round((Number(pass.previous_passed) / Number(pass.previous_total)) * 1000) / 10
          : null;

      const deptPassMap = new Map(
        deptPassRows.map((r) => [
          r.department_id,
          Number(r.total) > 0 ? Math.round((Number(r.passed) / Number(r.total)) * 1000) / 10 : null,
        ]),
      );
      const deptArrearsMap = new Map(deptArrearsRows.map((r) => [r.department_id, Number(r.arrear_papers)]));
      const deptTopperMap = new Map(
        deptTopperRows.map((r) => [r.department_id, r.topper_cgpa !== null ? Math.round(Number(r.topper_cgpa) * 100) / 100 : null]),
      );

      const totalStudents = cgpa ? Number(cgpa.total_students) : 0;

      return {
        pass_percentage: currentPassPct,
        pass_percentage_delta: currentPassPct !== null && previousPassPct !== null ? Math.round((currentPassPct - previousPassPct) * 10) / 10 : null,
        current_semester: currentSemester,
        students_with_arrears: arrears ? Number(arrears.students_with_arrears) : 0,
        arrear_papers: arrears ? Number(arrears.arrear_papers) : 0,
        high_cgpa_count: cgpa ? Number(cgpa.high_cgpa_count) : 0,
        high_cgpa_pct: totalStudents > 0 && cgpa ? Math.round((Number(cgpa.high_cgpa_count) / totalStudents) * 1000) / 10 : null,
        revaluation_total: revaluation ? Number(revaluation.total) : 0,
        revaluation_pending: revaluation ? Number(revaluation.pending) : 0,
        departments: departments.map((dept) => ({
          code: dept.code,
          name: dept.name,
          pass_pct: deptPassMap.get(dept.id) ?? null,
          arrear_papers: deptArrearsMap.get(dept.id) ?? 0,
          topper_cgpa: deptTopperMap.get(dept.id) ?? null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal exams & results overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
