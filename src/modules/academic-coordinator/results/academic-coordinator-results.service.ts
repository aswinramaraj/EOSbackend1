import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';

// Same bracket-lookup pattern as PrincipalExamsService's GRADE_LOOKUP —
// reused verbatim so a subject's pass/fail and grade point are computed
// identically everywhere in the app, per the user's "match Principal's
// precedent" decision for how Results should be shown.
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC
    LIMIT 1
  ) gb ON true
`;

interface CgpaRow {
  student_id: number;
  cgpa: string | null;
}
interface BacklogRow {
  student_id: number;
  backlogs: bigint;
}
interface SubjectPassRow {
  subject_id: number;
  subject_code: string;
  name: string;
  passed: bigint;
  total: bigint;
}
interface StatsRow {
  highest: string | null;
  lowest: string | null;
  avg_pct: string | null;
  passed: bigint;
  total: bigint;
}

@Injectable()
export class AcademicCoordinatorResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/results/classes/:classId
   *
   * Reuses PrincipalExamsService's exact CGPA/pass-rate/grade-bracket
   * formulas (see that file), scoped to one class instead of the whole
   * institution — there's no per-semester SGPA anywhere in this codebase
   * (verified: zero references), only a cumulative all-time CGPA across
   * every results_published exam, which is what's shown here too.
   */
  async classResults(classId: number) {
    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const [students, cgpaRows, backlogRows, subjectRows, statsRows] =
      await Promise.all([
        this.prisma.students.findMany({
          where: { class_id: classId, status: 'active' },
          select: {
            id: true,
            roll_no: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
          },
          orderBy: { roll_no: 'asc' },
        }),

        this.prisma.$queryRaw<CgpaRow[]>(Prisma.sql`
        SELECT em.student_id,
          (SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
            / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0))::text AS cgpa
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        JOIN students st ON st.id = em.student_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND st.class_id = ${classId} AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        GROUP BY em.student_id
      `),

        this.prisma.$queryRaw<BacklogRow[]>(Prisma.sql`
        WITH subject_attempts AS (
          SELECT em.student_id, esm.subject_id, BOOL_OR(gb.is_pass) AS ever_passed
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN students st ON st.id = em.student_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND st.class_id = ${classId}
          GROUP BY em.student_id, esm.subject_id
        )
        SELECT student_id, COUNT(*) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS backlogs
        FROM subject_attempts
        GROUP BY student_id
      `),

        this.prisma.$queryRaw<SubjectPassRow[]>(Prisma.sql`
        SELECT esm.subject_id, sub.subject_code, sub.name,
          COUNT(*) FILTER (WHERE gb.is_pass)::bigint AS passed,
          COUNT(*)::bigint AS total
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        JOIN students st ON st.id = em.student_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND st.class_id = ${classId}
        GROUP BY esm.subject_id, sub.subject_code, sub.name
      `),

        this.prisma.$queryRaw<StatsRow[]>(Prisma.sql`
        SELECT
          MAX(CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)::text AS highest,
          MIN(CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)::text AS lowest,
          AVG(CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)::text AS avg_pct,
          COUNT(*) FILTER (WHERE gb.is_pass)::bigint AS passed,
          COUNT(*)::bigint AS total
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN students st ON st.id = em.student_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND st.class_id = ${classId}
      `),
      ]);

    const cgpaByStudent = new Map(
      cgpaRows.map((r) => [
        r.student_id,
        r.cgpa !== null ? Math.round(Number(r.cgpa) * 100) / 100 : null,
      ]),
    );
    const backlogsByStudent = new Map(
      backlogRows.map((r) => [r.student_id, Number(r.backlogs)]),
    );

    const rows = students.map((s) => {
      const cgpa = cgpaByStudent.get(s.id) ?? null;
      const backlogs = backlogsByStudent.get(s.id) ?? 0;
      const standing =
        cgpa != null && cgpa >= 8.5
          ? 'Top performer'
          : backlogs > 0
            ? 'At risk'
            : cgpa != null
              ? 'On track'
              : 'No results yet';
      return {
        student: {
          id: s.id,
          roll_no: s.roll_no,
          name:
            [s.soa_applications?.first_name, s.soa_applications?.last_name]
              .filter(Boolean)
              .join(' ') || s.student_id_no,
        },
        cgpa,
        backlogs,
        standing,
      };
    });

    const subjects = subjectRows.map((r) => ({
      subject_id: r.subject_id,
      subject_code: r.subject_code,
      subject_name: r.name,
      pass_percentage:
        Number(r.total) > 0
          ? Math.round((Number(r.passed) / Number(r.total)) * 1000) / 10
          : null,
    }));

    const stats = statsRows[0];
    const backlogCount = rows.filter((r) => r.backlogs > 0).length;

    return {
      class_id: classId,
      pass_percentage:
        stats && Number(stats.total) > 0
          ? Math.round((Number(stats.passed) / Number(stats.total)) * 1000) / 10
          : null,
      class_average:
        stats?.avg_pct != null
          ? Math.round(Number(stats.avg_pct) * 10) / 10
          : null,
      highest_mark:
        stats?.highest != null
          ? Math.round(Number(stats.highest) * 10) / 10
          : null,
      lowest_mark:
        stats?.lowest != null
          ? Math.round(Number(stats.lowest) * 10) / 10
          : null,
      students_with_backlogs: backlogCount,
      subjects,
      rows,
    };
  }
}
