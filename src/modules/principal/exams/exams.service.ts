import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function fullName(first: string, last: string | null): string {
  return last ? `${first} ${last}` : first;
}

/** Real grade_bands rows, ordered by display_order — highest grade first. */
async function loadGradeBands(prisma: PrismaService) {
  return prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } });
}

function gradeFor(
  percentage: number,
  bands: {
    grade_label: string;
    min_percentage: unknown;
    grade_point: unknown;
    is_pass: boolean;
  }[],
): { label: string; is_pass: boolean } {
  for (const b of bands) {
    if (percentage >= Number(b.min_percentage)) {
      return { label: b.grade_label, is_pass: b.is_pass };
    }
  }
  return { label: bands[bands.length - 1]?.grade_label ?? 'U', is_pass: false };
}

@Injectable()
export class PrincipalExamsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/principal/exams/summary
   *
   * The reference design wants "Students with arrears" and "CGPA above
   * 8.5". Neither is computable: there is no arrears concept anywhere in
   * the schema (no status/table tracks "failed and not yet cleared"), and
   * CGPA needs a single composite pass/fail per subject combining internal
   * + external marks — exam_marks has no such split (real data confirms
   * max_marks is inconsistently 50 or 100 across rows, so the split can't
   * be recovered). exam_pass_rules_settings assumes that split exists and
   * is therefore unusable here.
   *
   * What's real: grade_bands (7 rows, real, well-formed) lets every
   * individual exam_marks row be graded by percentage. "Pass percentage"
   * and the two substitute cards below are computed per exam attempt, not
   * as a final composite subject result — labelled as such in the UI.
   */
  async summary() {
    const [marks, revaluationTotal, revaluationPending] = await Promise.all([
      this.prisma.exam_marks.findMany({
        where: { is_absent: false },
        select: { marks_obtained: true, max_marks: true, student_id: true },
      }),
      this.prisma.revaluation_requests.count(),
      this.prisma.revaluation_requests.count({
        where: { status: 'requested' },
      }),
    ]);
    const bands = await loadGradeBands(this.prisma);

    let passCount = 0;
    let failCount = 0;
    const failingStudents = new Set<number>();
    const highScoreStudents = new Set<number>();
    const oBand = bands[0];

    for (const m of marks) {
      if (m.marks_obtained == null) continue;
      const pct = (Number(m.marks_obtained) / Number(m.max_marks)) * 100;
      const grade = gradeFor(pct, bands);
      if (grade.is_pass) passCount += 1;
      else {
        failCount += 1;
        failingStudents.add(m.student_id);
      }
      if (oBand && pct >= Number(oBand.min_percentage))
        highScoreStudents.add(m.student_id);
    }

    const gradedTotal = passCount + failCount;

    return {
      pass_percentage:
        gradedTotal > 0
          ? Math.round((passCount / gradedTotal) * 1000) / 10
          : null,
      failing_attempts: { count: failCount, students: failingStudents.size },
      high_scorers: {
        students: highScoreStudents.size,
        grade_label: oBand?.grade_label ?? 'O',
      },
      revaluation: { total: revaluationTotal, pending: revaluationPending },
    };
  }

  /** GET /me/principal/exams/filters — real batches + exam types for the filter row. */
  async filters() {
    const [batches, examTypes] = await Promise.all([
      this.prisma.batches.findMany({ orderBy: { start_year: 'desc' } }),
      this.prisma.exam_types.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return {
      batches: batches.map((b) => ({
        id: b.id,
        label: `${b.start_year}-${b.end_year}`,
      })),
      exam_types: examTypes.map((t) => ({
        id: t.id,
        name: t.name,
        code: t.code,
      })),
    };
  }

  /** GET /me/principal/exams/classes?batch_id= — real department/semester/section options for that batch. */
  async classesForBatch(batchId: number) {
    const classes = await this.prisma.classes.findMany({
      where: { batch_id: batchId },
      select: {
        id: true,
        section: true,
        current_semester: true,
        departments: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ department_id: 'asc' }, { section: 'asc' }],
    });
    return classes;
  }

  /**
   * GET /me/principal/exams/semesters?batch_id= — distinct semesters that
   * actually have exam data for this batch. Deliberately queries `exams`,
   * not `classes.current_semester`: a class row tracks only where the
   * cohort is *now* (e.g. batch 2022-2026 shows current_semester=7 for
   * every one of its classes), not which semesters it has historical exam
   * data for — semester 3's exams from 2023 are still real and queryable
   * even though the class has since moved on.
   */
  async semestersForBatch(batchId: number) {
    const rows = await this.prisma.exams.findMany({
      where: { batch_id: batchId },
      select: { semester: true },
      distinct: ['semester'],
      orderBy: { semester: 'asc' },
    });
    return rows.map((r) => r.semester);
  }

  /** GET /me/principal/exams/exams?batch_id=&semester= — real exam instances available for that batch+semester. */
  async examsForBatchSemester(batchId: number, semester: number) {
    const exams = await this.prisma.exams.findMany({
      where: { batch_id: batchId, semester },
      select: {
        id: true,
        title: true,
        academic_year: true,
        semester: true,
        status: true,
        exam_types: { select: { name: true, code: true } },
      },
      orderBy: { id: 'desc' },
    });
    return exams;
  }

  /**
   * GET /me/principal/exams/results?exam_id=&class_id= — the real marks
   * table: every real exam_subject_mapping row for this exam+class becomes
   * a column, every real student in the class becomes a row, every real
   * exam_marks row (if entered) becomes a graded cell. A subject with no
   * exam_marks row yet for a student renders as "not entered", not 0 —
   * there's a real difference between "scored zero" and "no data yet".
   */
  async results(examId: number, classId: number) {
    const bands = await loadGradeBands(this.prisma);

    const [mappings, students, exam, classRow] = await Promise.all([
      this.prisma.exam_subject_mapping.findMany({
        where: { exam_id: examId, class_id: classId },
        select: {
          id: true,
          subjects: { select: { subject_code: true, name: true } },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.students.findMany({
        where: { class_id: classId, status: 'active' },
        select: {
          id: true,
          student_id_no: true,
          register_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
        },
        orderBy: { student_id_no: 'asc' },
      }),
      this.prisma.exams.findUnique({
        where: { id: examId },
        select: { title: true, academic_year: true, semester: true },
      }),
      this.prisma.classes.findUnique({
        where: { id: classId },
        select: {
          section: true,
          departments: { select: { name: true, code: true } },
        },
      }),
    ]);

    const mappingIds = mappings.map((m) => m.id);
    const studentIds = students.map((s) => s.id);

    const marks =
      mappingIds.length && studentIds.length
        ? await this.prisma.exam_marks.findMany({
            where: {
              exam_subject_mapping_id: { in: mappingIds },
              student_id: { in: studentIds },
            },
            select: {
              exam_subject_mapping_id: true,
              student_id: true,
              marks_obtained: true,
              max_marks: true,
              is_absent: true,
            },
          })
        : [];

    const markByKey = new Map(
      marks.map((m) => [`${m.student_id}:${m.exam_subject_mapping_id}`, m]),
    );

    const rows = students.map((s) => {
      const cells = mappings.map((mapping) => {
        const mark = markByKey.get(`${s.id}:${mapping.id}`);
        if (!mark)
          return {
            subject_code: mapping.subjects.subject_code,
            entered: false,
            is_absent: false,
            marks_obtained: null,
            max_marks: null,
            percentage: null,
            grade: null,
          };
        if (mark.is_absent)
          return {
            subject_code: mapping.subjects.subject_code,
            entered: true,
            is_absent: true,
            marks_obtained: null,
            max_marks: Number(mark.max_marks),
            percentage: null,
            grade: null,
          };
        const pct =
          mark.marks_obtained != null
            ? (Number(mark.marks_obtained) / Number(mark.max_marks)) * 100
            : null;
        const grade = pct != null ? gradeFor(pct, bands) : null;
        return {
          subject_code: mapping.subjects.subject_code,
          entered: true,
          is_absent: false,
          marks_obtained:
            mark.marks_obtained != null ? Number(mark.marks_obtained) : null,
          max_marks: Number(mark.max_marks),
          percentage: pct != null ? Math.round(pct * 10) / 10 : null,
          grade: grade?.label ?? null,
        };
      });

      const graded = cells.filter((c) => c.percentage != null);
      const averagePercentage =
        graded.length > 0
          ? Math.round(
              (graded.reduce((sum, c) => sum + (c.percentage ?? 0), 0) /
                graded.length) *
                10,
            ) / 10
          : null;

      return {
        student_id_no: s.student_id_no,
        register_no: s.register_no,
        name: s.soa_applications
          ? fullName(
              s.soa_applications.first_name,
              s.soa_applications.last_name,
            )
          : s.users.email,
        cells,
        average_percentage: averagePercentage,
      };
    });

    return {
      exam: exam
        ? {
            title: exam.title,
            academic_year: exam.academic_year,
            semester: exam.semester,
          }
        : null,
      class: classRow
        ? {
            section: classRow.section,
            department: classRow.departments.name,
            department_code: classRow.departments.code,
          }
        : null,
      subjects: mappings.map((m) => ({
        subject_code: m.subjects.subject_code,
        name: m.subjects.name,
      })),
      candidate_count: students.length,
      paper_count: mappings.length,
      rows,
    };
  }
}
