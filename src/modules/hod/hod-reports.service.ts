import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/** Same formula as PrincipalExamsService's GRADE_LOOKUP, reused verbatim from HodService. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC LIMIT 1
  ) gb ON true
`;

/** No stored "distinction" flag/threshold anywhere in the schema — 8.5 SGPA is the standard First Class with Distinction cutoff, used here as the clearest available honest convention rather than an arbitrary guess. */
const DISTINCTION_SGPA_CUTOFF = 8.5;

interface CgpaRow {
  avg_cgpa: string | null;
}
interface PassPctRow {
  pass_pct: string | null;
}
interface ArrearsRow {
  students_with_arrears: bigint;
}
interface DistinctionRow {
  distinction_count: bigint;
}
interface SubjectRow {
  subject_id: number;
  name: string;
  code: string;
  class_id: number;
  section: string;
  pass_pct: string | null;
}
interface SubjectFacultyRow {
  subject_id: number;
  class_id: number;
  first_name: string;
  last_name: string;
}
export interface HodSubjectResult {
  subject_id: number;
  name: string;
  code: string;
  faculty_label: string | null;
  sections: { section: string; pass_percent: number | null }[];
  average_pass_percent: number | null;
  change_pts: number | null;
  needs_remedial: boolean;
  lowest_section_label: string | null;
}

function gradeCgpaCte(departmentId: number, semester: number | undefined) {
  return Prisma.sql`
    WITH student_cgpa AS (
      SELECT em.student_id,
        (SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
          / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0)) AS cgpa
      FROM exam_marks em
      JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
      JOIN exams e ON e.id = esm.exam_id
      JOIN subjects sub ON sub.id = esm.subject_id
      JOIN classes cl ON cl.id = esm.class_id
      ${GRADE_LOOKUP}
      WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        AND cl.department_id = ${departmentId}
        ${semester !== undefined ? Prisma.sql`AND e.semester = ${semester}` : Prisma.empty}
      GROUP BY em.student_id
    )
    SELECT AVG(cgpa)::text AS avg_cgpa FROM student_cgpa
  `;
}

/**
 * GET /hod/reports/summary|classes|subjects — same discipline as
 * HodService.getDashboard: every field reads a real table, every query
 * runs sequentially (Supabase's session-mode pool caps at 15 connections —
 * see HodService's own comments for why Promise.all across multiple raw
 * queries is unsafe here).
 *
 * Unlike the dashboard (which follows the STUDENT's current department via
 * students->classes, appropriate for "this student's cumulative standing"),
 * these report queries follow the EXAM/CLASS via
 * exam_subject_mapping.class_id->classes.department_id — appropriate for
 * "how did the classes taught in my department perform in this exam",
 * which is what a results/analytics report is actually asking.
 */
@Injectable()
export class HodReportsService {
  private readonly logger = new Logger(HodReportsService.name);

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

  private async recentSemesters(): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ semester: number }[]>(Prisma.sql`
      SELECT DISTINCT semester FROM exams WHERE status = 'results_published' ORDER BY semester DESC LIMIT 2
    `);
    return rows.map((r) => r.semester);
  }

  private async passPercentFor(
    departmentId: number,
    semester: number,
  ): Promise<number | null> {
    const [row] = await this.prisma.$queryRaw<PassPctRow[]>(Prisma.sql`
      WITH attempts AS (
        SELECT gb.is_pass
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN classes cl ON cl.id = esm.class_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND e.semester = ${semester}
          AND cl.department_id = ${departmentId}
          AND em.is_absent = false AND em.marks_obtained IS NOT NULL
      )
      SELECT (COUNT(*) FILTER (WHERE is_pass)::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pass_pct
      FROM attempts
    `);
    return row?.pass_pct != null
      ? Math.round(Number(row.pass_pct) * 10) / 10
      : null;
  }

  private async arrearsCountFor(
    departmentId: number,
    semester: number,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<ArrearsRow[]>(Prisma.sql`
      WITH subject_attempts AS (
        SELECT em.student_id, esm.subject_id, BOOL_OR(gb.is_pass) AS ever_passed
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN classes cl ON cl.id = esm.class_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND e.semester = ${semester} AND cl.department_id = ${departmentId}
        GROUP BY em.student_id, esm.subject_id
      )
      SELECT COUNT(DISTINCT student_id) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS students_with_arrears
      FROM subject_attempts
    `);
    return Number(row?.students_with_arrears ?? 0);
  }

  private async distinctionCountFor(
    departmentId: number,
    semester: number,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<DistinctionRow[]>(Prisma.sql`
      WITH student_sgpa AS (
        SELECT em.student_id,
          (SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
            / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0)) AS sgpa
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        JOIN classes cl ON cl.id = esm.class_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND e.semester = ${semester} AND cl.department_id = ${departmentId}
          AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        GROUP BY em.student_id
      )
      SELECT COUNT(*) FILTER (WHERE sgpa >= ${DISTINCTION_SGPA_CUTOFF})::bigint AS distinction_count
      FROM student_sgpa
    `);
    return Number(row?.distinction_count ?? 0);
  }

  async getSummary(user: JwtPayload) {
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
      const studentCount = await this.prisma.students.count({
        where: { status: 'active', classes: { department_id: departmentId } },
      });

      // Real `faculty.qualification` free-text field — matched for any
      // spelling of PhD/Ph.D/Doctorate rather than an exact string. Reads
      // honestly as 0 if the field simply isn't populated yet, same as
      // every other "no data yet" stat on this page — never fabricated.
      const phdCount = await this.prisma.faculty.count({
        where: {
          department_id: departmentId,
          status: 'active',
          OR: [
            { qualification: { contains: 'PhD', mode: 'insensitive' } },
            { qualification: { contains: 'Ph.D', mode: 'insensitive' } },
            { qualification: { contains: 'Doctorate', mode: 'insensitive' } },
          ],
        },
      });
      const facultyCount = await this.prisma.faculty.count({
        where: { department_id: departmentId, status: 'active' },
      });

      const semesters = await this.recentSemesters();
      const [currentSem, previousSem] = semesters;

      const currentPassPct =
        currentSem !== undefined
          ? await this.passPercentFor(departmentId, currentSem)
          : null;
      const previousPassPct =
        previousSem !== undefined
          ? await this.passPercentFor(departmentId, previousSem)
          : null;

      const currentCgpaRow = await this.prisma.$queryRaw<CgpaRow[]>(
        gradeCgpaCte(departmentId, currentSem),
      );
      const previousCgpaRow =
        previousSem !== undefined
          ? await this.prisma.$queryRaw<CgpaRow[]>(
              gradeCgpaCte(departmentId, previousSem),
            )
          : [];
      const currentCgpa = currentCgpaRow[0]?.avg_cgpa;
      const previousCgpa = previousCgpaRow[0]?.avg_cgpa;

      const currentArrears =
        currentSem !== undefined
          ? await this.arrearsCountFor(departmentId, currentSem)
          : 0;
      const previousArrears =
        previousSem !== undefined
          ? await this.arrearsCountFor(departmentId, previousSem)
          : null;

      const currentDistinction =
        currentSem !== undefined
          ? await this.distinctionCountFor(departmentId, currentSem)
          : 0;
      const previousDistinction =
        previousSem !== undefined
          ? await this.distinctionCountFor(departmentId, previousSem)
          : null;

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        student_count: studentCount,
        pass_percent: currentPassPct,
        pass_percent_change:
          currentPassPct != null && previousPassPct != null
            ? Math.round((currentPassPct - previousPassPct) * 10) / 10
            : null,
        average_cgpa:
          currentCgpa != null
            ? Math.round(Number(currentCgpa) * 100) / 100
            : null,
        average_cgpa_change:
          currentCgpa != null && previousCgpa != null
            ? Math.round((Number(currentCgpa) - Number(previousCgpa)) * 100) /
              100
            : null,
        arrears_count: currentArrears,
        arrears_count_change:
          previousArrears != null ? currentArrears - previousArrears : null,
        distinction_count: currentDistinction,
        distinction_count_change:
          previousDistinction != null
            ? currentDistinction - previousDistinction
            : 0,
        phd_count: phdCount,
        faculty_count: facultyCount,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD reports summary', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * "II"/"III"/"IV" maps to a class's year-level via ceil(current_semester / 2)
   * — the only year-level signal classes actually stores.
   *
   * Current/previous semester is resolved PER CLASS (its own
   * current_semester, and current_semester - 2) rather than one global pair
   * for the whole department — different year-groups are at different
   * semesters at the same point in time (a 4th-year class's "previous
   * semester" is semester 5, a 2nd-year class's is semester 1), so a single
   * department-wide pair applied to every row would compare a class against
   * an unrelated semester (or a semester it was never even in). -2 rather
   * than -1: this system only ever holds exam data for odd semesters
   * (1,3,5,7 — see scripts/seed-cse-sem5/04-exam-infra-sem1-3.ts), so a
   * class's real "previous" term is the prior ODD semester, not N-1 (which
   * is always even and never has data).
   */
  async getClassPassRates(user: JwtPayload, year: string | null) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const classRows = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true, section: true, current_semester: true },
      });
      const yearFiltered = year
        ? classRows.filter(
            (c) =>
              c.current_semester != null &&
              ['I', 'II', 'III', 'IV'][
                Math.ceil(c.current_semester / 2) - 1
              ] === year,
          )
        : classRows;

      const results: {
        class_id: number;
        section: string;
        year: string;
        semester: number;
        current_pass_percent: number | null;
        previous_semester: number | null;
        previous_pass_percent: number | null;
        change_pts: number | null;
      }[] = [];

      // Sequential per class — same pooler-capacity reasoning as HodService.
      for (const cl of yearFiltered) {
        const currentSem = cl.current_semester;
        if (currentSem == null) continue;
        const previousSem = currentSem > 2 ? currentSem - 2 : undefined;

        const [currentRow] = await this.prisma.$queryRaw<
          PassPctRow[]
        >(Prisma.sql`
          WITH attempts AS (
            SELECT gb.is_pass
            FROM exam_marks em
            JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
            JOIN exams e ON e.id = esm.exam_id
            ${GRADE_LOOKUP}
            WHERE e.status = 'results_published' AND e.semester = ${currentSem} AND esm.class_id = ${cl.id}
              AND em.is_absent = false AND em.marks_obtained IS NOT NULL
          )
          SELECT (COUNT(*) FILTER (WHERE is_pass)::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pass_pct
          FROM attempts
        `);
        const currentPct =
          currentRow?.pass_pct != null
            ? Math.round(Number(currentRow.pass_pct) * 10) / 10
            : null;

        let previousPct: number | null = null;
        if (previousSem !== undefined) {
          const [previousRow] = await this.prisma.$queryRaw<
            PassPctRow[]
          >(Prisma.sql`
            WITH attempts AS (
              SELECT gb.is_pass
              FROM exam_marks em
              JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
              JOIN exams e ON e.id = esm.exam_id
              ${GRADE_LOOKUP}
              WHERE e.status = 'results_published' AND e.semester = ${previousSem} AND esm.class_id = ${cl.id}
                AND em.is_absent = false AND em.marks_obtained IS NOT NULL
            )
            SELECT (COUNT(*) FILTER (WHERE is_pass)::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pass_pct
            FROM attempts
          `);
          previousPct =
            previousRow?.pass_pct != null
              ? Math.round(Number(previousRow.pass_pct) * 10) / 10
              : null;
        }

        results.push({
          class_id: cl.id,
          section: cl.section,
          year: ['I', 'II', 'III', 'IV'][Math.ceil(currentSem / 2) - 1],
          semester: currentSem,
          current_pass_percent: currentPct,
          previous_semester: previousSem ?? null,
          previous_pass_percent: previousPct,
          change_pts:
            currentPct != null && previousPct != null
              ? Math.round((currentPct - previousPct) * 10) / 10
              : null,
        });
      }

      const withChange = results.filter((r) => r.change_pts != null);
      const bestMovement =
        withChange.length > 0
          ? withChange.reduce((a, b) => (b.change_pts! > a.change_pts! ? b : a))
          : null;
      const decliningClasses = withChange.filter((r) => r.change_pts! < 0);
      const improving = withChange.filter((r) => r.change_pts! > 0);
      const lowestButImproving =
        improving.length > 0
          ? improving.reduce((a, b) =>
              (b.current_pass_percent ?? 0) < (a.current_pass_percent ?? 0)
                ? b
                : a,
            )
          : null;

      return {
        classes: results,
        best_movement: bestMovement,
        declining_count: decliningClasses.length,
        declining_classes: decliningClasses.map(
          (r) => `${r.year}-${r.section}`,
        ),
        lowest_but_improving: lowestButImproving,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD class pass rates', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * One group per distinct current_semester actually present among this
   * department's classes (not one global "most recent semester" pair —
   * different year-groups are at different semesters simultaneously, so a
   * single semester would only ever show one year's subjects while the
   * frontend's `groups[]` shape expects every active year-group). Each
   * group's own "previous" is that semester number minus 1.
   */
  async getSubjectResults(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const classSemesters = await this.prisma.classes.findMany({
        where: { department_id: departmentId, current_semester: { not: null } },
        select: { current_semester: true },
        distinct: ['current_semester'],
      });
      const activeSemesters = classSemesters
        .map((c) => c.current_semester!)
        .sort((a, b) => b - a);

      const groups: {
        semester: number;
        year: string;
        sections: string[];
        subjects: HodSubjectResult[];
      }[] = [];

      // Sequential per semester-group — same pooler-capacity reasoning as every other hod service.
      for (const currentSem of activeSemesters) {
        const subjects = await this.buildSubjectRows(departmentId, currentSem);
        if (subjects.subjects.length === 0) continue;
        groups.push({
          semester: currentSem,
          year: ['I', 'II', 'III', 'IV'][Math.ceil(currentSem / 2) - 1],
          sections: subjects.sections,
          subjects: subjects.subjects,
        });
      }

      return { groups };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD subject results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async buildSubjectRows(
    departmentId: number,
    currentSem: number,
  ): Promise<{ sections: string[]; subjects: HodSubjectResult[] }> {
    // -2, not -1: see getClassPassRates' doc comment — this system only
    // ever holds exam data for odd semesters.
    const previousSem = currentSem > 2 ? currentSem - 2 : undefined;

    // Every (subject, class) combo examined this semester in this
    // department, with its per-section pass %.
    const subjectRows = await this.prisma.$queryRaw<SubjectRow[]>(Prisma.sql`
        WITH attempts AS (
          SELECT esm.subject_id, sub.name, sub.subject_code AS code, esm.class_id, cl.section, gb.is_pass
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN subjects sub ON sub.id = esm.subject_id
          JOIN classes cl ON cl.id = esm.class_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND e.semester = ${currentSem} AND cl.department_id = ${departmentId}
            AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        )
        SELECT subject_id, name, code, class_id, section,
          (COUNT(*) FILTER (WHERE is_pass)::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pass_pct
        FROM attempts
        GROUP BY subject_id, name, code, class_id, section
        ORDER BY name, section
      `);

    const previousPctBySubject = new Map<number, number | null>();
    if (previousSem !== undefined) {
      const previousRows = await this.prisma.$queryRaw<
        { subject_id: number; pass_pct: string | null }[]
      >(Prisma.sql`
          WITH attempts AS (
            SELECT esm.subject_id, gb.is_pass
            FROM exam_marks em
            JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
            JOIN exams e ON e.id = esm.exam_id
            JOIN classes cl ON cl.id = esm.class_id
            ${GRADE_LOOKUP}
            WHERE e.status = 'results_published' AND e.semester = ${previousSem} AND cl.department_id = ${departmentId}
              AND em.is_absent = false AND em.marks_obtained IS NOT NULL
          )
          SELECT subject_id, (COUNT(*) FILTER (WHERE is_pass)::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pass_pct
          FROM attempts GROUP BY subject_id
        `);
      for (const r of previousRows) {
        previousPctBySubject.set(
          r.subject_id,
          r.pass_pct != null ? Math.round(Number(r.pass_pct) * 10) / 10 : null,
        );
      }
    }

    const classIds = [...new Set(subjectRows.map((r) => r.class_id))];
    const facultyRows = classIds.length
      ? await this.prisma.$queryRaw<SubjectFacultyRow[]>(Prisma.sql`
            SELECT fscm.subject_id, fscm.class_id, f.first_name, f.last_name
            FROM faculty_subject_class_mapping fscm
            JOIN faculty f ON f.id = fscm.faculty_id
            WHERE fscm.class_id IN (${Prisma.join(classIds)})
          `)
      : [];
    const facultyLabel = new Map<string, string>();
    for (const r of facultyRows) {
      facultyLabel.set(
        `${r.subject_id}-${r.class_id}`,
        `${r.first_name} ${r.last_name}`.trim(),
      );
    }

    const bySubject = new Map<
      number,
      { name: string; code: string; sections: SubjectRow[] }
    >();
    for (const row of subjectRows) {
      const entry = bySubject.get(row.subject_id) ?? {
        name: row.name,
        code: row.code,
        sections: [],
      };
      entry.sections.push(row);
      bySubject.set(row.subject_id, entry);
    }

    const subjects = Array.from(bySubject.entries()).map(
      ([subjectId, entry]) => {
        const sectionPcts = entry.sections
          .map((s) => (s.pass_pct != null ? Number(s.pass_pct) : null))
          .filter((v): v is number => v != null);
        const averagePct =
          sectionPcts.length > 0
            ? Math.round(
                (sectionPcts.reduce((a, b) => a + b, 0) / sectionPcts.length) *
                  10,
              ) / 10
            : null;
        const changePts =
          averagePct != null && previousPctBySubject.get(subjectId) != null
            ? Math.round(
                (averagePct - previousPctBySubject.get(subjectId)!) * 10,
              ) / 10
            : null;
        const lowestSection = entry.sections.reduce(
          (lowest, s) =>
            (s.pass_pct != null ? Number(s.pass_pct) : 101) <
            (lowest?.pass_pct != null ? Number(lowest.pass_pct) : 101)
              ? s
              : lowest,
          entry.sections[0],
        );
        const needsRemedial =
          lowestSection?.pass_pct != null &&
          Number(lowestSection.pass_pct) < 80;
        const firstFacultyKey = entry.sections[0]
          ? `${subjectId}-${entry.sections[0].class_id}`
          : '';

        return {
          subject_id: subjectId,
          name: entry.name,
          code: entry.code,
          faculty_label: facultyLabel.get(firstFacultyKey) ?? null,
          sections: entry.sections.map((s) => ({
            section: s.section,
            pass_percent:
              s.pass_pct != null
                ? Math.round(Number(s.pass_pct) * 10) / 10
                : null,
          })),
          average_pass_percent: averagePct,
          change_pts: changePts,
          needs_remedial: needsRemedial,
          lowest_section_label: needsRemedial ? lowestSection.section : null,
        };
      },
    );

    const allSections = [...new Set(subjectRows.map((r) => r.section))].sort();

    return { sections: allSections, subjects };
  }
}
