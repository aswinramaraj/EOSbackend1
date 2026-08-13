import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { computeGpa, isPassingPercentage } from '../shared/grade-scale.util';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** classes.current_semester (1-based) -> year label, e.g. 3 or 4 -> "II". */
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

/** The minimum shape needed to decide pass/fail for one exam_marks row. */
interface GradedMarkRow {
  student_id: number;
  marks_obtained: unknown;
  max_marks: unknown;
  is_absent: boolean;
}

/** Full shape needed when a row also has to contribute to a credit-weighted GPA. */
interface MarkRow extends GradedMarkRow {
  exam_subject_mapping: {
    class_id: number;
    subject_id: number;
    subjects: { credits: number | null };
  };
}

function toPercentage(marksObtained: unknown, maxMarks: unknown): number {
  const scored = Number(marksObtained);
  const max = Number(maxMarks);
  return max > 0 ? (scored / max) * 100 : 0;
}

/**
 * A row not yet entered (marks_obtained is null, is_absent is false — the
 * faculty simply hasn't graded it yet) carries no pass/fail signal at all;
 * counting it as a fail would silently conflate "not graded yet" with "sat
 * the exam and failed", which is exactly the distinct condition the
 * dashboard's own "marks not entered" flag needs to detect separately.
 */
function isGraded(row: GradedMarkRow): boolean {
  return row.is_absent || row.marks_obtained != null;
}

/** Pass % across a set of already-graded exam_marks rows (absentees count as fails, matching this being the only pass/fail precedent in the codebase). */
function passPercent(rows: GradedMarkRow[]): number | null {
  const graded = rows.filter(isGraded);
  if (graded.length === 0) return null;
  const passed = graded.filter(
    (r) =>
      !r.is_absent &&
      isPassingPercentage(toPercentage(r.marks_obtained, r.max_marks)),
  ).length;
  return Math.round((passed / graded.length) * 1000) / 10;
}

@Injectable()
export class HodReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return { faculty, department };
  }

  private async getDepartmentClasses(departmentId: number) {
    return this.prisma.classes.findMany({
      where: { department_id: departmentId, current_semester: { not: null } },
      select: { id: true, section: true, current_semester: true },
    });
  }

  /**
   * Pass % for one class at one semester, computed from that class's own
   * exam_subject_mapping rows for its "external" (end-semester university)
   * exam at that semester — internal/CIA exams are excluded, matching the
   * only existing pass/fail precedent in this codebase (the frontend's
   * GRADE_SCALE, which is itself computed from semester_exam results only).
   */
  private async classPassPercent(classId: number, semester: number) {
    const rows = (await this.prisma.exam_marks.findMany({
      where: {
        exam_subject_mapping: {
          class_id: classId,
          exams: { semester, exam_types: { category: 'external' } },
        },
      },
      select: {
        student_id: true,
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        exam_subject_mapping: {
          select: {
            class_id: true,
            subject_id: true,
            subjects: { select: { credits: true } },
          },
        },
      },
    })) as MarkRow[];
    return passPercent(rows);
  }

  /**
   * Reused by hod-dashboard for its "declining subject" flag and by this
   * module's own class-comparison endpoint — one class's current-semester
   * pass % vs its own immediately-previous semester (same class_id, since
   * `classes` rows persist across a batch's whole duration and
   * current_semester simply advances on the same row; there is no
   * cross-year class-lineage table to instead infer this from).
   */
  async classComparisons(departmentId: number) {
    const classes = await this.getDepartmentClasses(departmentId);
    const results = await Promise.all(
      classes.map(async (c) => {
        const semester = c.current_semester as number;
        const [current, previous] = await Promise.all([
          this.classPassPercent(c.id, semester),
          semester > 1 ? this.classPassPercent(c.id, semester - 1) : null,
        ]);
        return {
          class_id: c.id,
          section: c.section,
          year: yearLabelForSemester(semester),
          semester,
          current_pass_percent: current,
          previous_semester: semester > 1 ? semester - 1 : null,
          previous_pass_percent: previous,
          change_pts:
            current !== null && previous !== null
              ? Math.round((current - previous) * 10) / 10
              : null,
        };
      }),
    );
    return results.filter((r) => r.current_pass_percent !== null);
  }

  /** GET /hod/reports/summary */
  async getSummary(userId: number) {
    const { department } = await this.resolveHodDepartment(userId);
    const classes = await this.getDepartmentClasses(department.id);
    const classIds = classes.map((c) => c.id);

    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds }, status: 'active' },
      select: { id: true },
    });
    const studentIds = students.map((s) => s.id);

    const [currentMarks, previousMarks] = await Promise.all([
      this.currentSemesterMarks(classes),
      this.previousSemesterMarks(classes),
    ]);

    const currentPass = passPercent(currentMarks);
    const previousPass = passPercent(previousMarks);

    const cgpaByStudent = this.cgpaPerStudent(currentMarks);
    const previousCgpaByStudent = this.cgpaPerStudent(previousMarks);
    const cgpaValues = [...cgpaByStudent.values()].filter(
      (v): v is number => v !== null,
    );
    const previousCgpaValues = [...previousCgpaByStudent.values()].filter(
      (v): v is number => v !== null,
    );
    const avgCgpa = average(cgpaValues);
    const avgPreviousCgpa = average(previousCgpaValues);

    const arrearsCount = countDistinctFailingStudents(currentMarks);
    const previousArrearsCount = countDistinctFailingStudents(previousMarks);
    const distinctionCount = cgpaValues.filter((v) => v >= 8.5).length;
    const previousDistinctionCount = previousCgpaValues.filter(
      (v) => v >= 8.5,
    ).length;

    return {
      department,
      student_count: studentIds.length,
      pass_percent: currentPass,
      pass_percent_change:
        currentPass !== null && previousPass !== null
          ? Math.round((currentPass - previousPass) * 10) / 10
          : null,
      average_cgpa: avgCgpa,
      average_cgpa_change:
        avgCgpa !== null && avgPreviousCgpa !== null
          ? Math.round((avgCgpa - avgPreviousCgpa) * 100) / 100
          : null,
      arrears_count: arrearsCount,
      arrears_count_change:
        arrearsCount !== null && previousArrearsCount !== null
          ? arrearsCount - previousArrearsCount
          : null,
      distinction_count: distinctionCount,
      distinction_count_change: distinctionCount - previousDistinctionCount,
    };
  }

  /** GET /hod/reports/classes — pass % by class, current vs previous semester, ranked high to low. */
  async getClassPassRates(userId: number, yearFilter?: string) {
    const { department } = await this.resolveHodDepartment(userId);
    let comparisons = await this.classComparisons(department.id);
    if (yearFilter) {
      comparisons = comparisons.filter((c) => c.year === yearFilter);
    }
    comparisons.sort(
      (a, b) => (b.current_pass_percent ?? 0) - (a.current_pass_percent ?? 0),
    );

    const withChange = comparisons.filter((c) => c.change_pts !== null);
    const bestMovement = withChange.length
      ? withChange.reduce((a, b) =>
          (b.change_pts as number) > (a.change_pts as number) ? b : a,
        )
      : null;
    const declining = withChange.filter((c) => (c.change_pts as number) < 0);
    const lowestButImproving = comparisons
      .filter((c) => c.change_pts !== null && c.change_pts > 0)
      .reduce<(typeof comparisons)[number] | null>(
        (lowest, c) =>
          lowest === null ||
          (c.current_pass_percent as number) <
            (lowest.current_pass_percent as number)
            ? c
            : lowest,
        null,
      );

    return {
      classes: comparisons,
      best_movement: bestMovement,
      declining_count: declining.length,
      declining_classes: declining.map((c) => `${c.year}-${c.section}`),
      lowest_but_improving: lowestButImproving,
    };
  }

  /** GET /hod/reports/subjects — subject-wise pass % per section, grouped by year/semester. */
  async getSubjectResults(userId: number) {
    const { department } = await this.resolveHodDepartment(userId);
    const classes = await this.getDepartmentClasses(department.id);

    const semesterGroups = new Map<number, typeof classes>();
    for (const c of classes) {
      const sem = c.current_semester as number;
      const list = semesterGroups.get(sem) ?? [];
      list.push(c);
      semesterGroups.set(sem, list);
    }

    const groups = await Promise.all(
      [...semesterGroups.entries()]
        .sort(([a], [b]) => a - b)
        .map(async ([semester, classesInSemester]) => {
          const classIds = classesInSemester.map((c) => c.id);
          const [currentRows, previousRows, teachingAssignments] =
            await Promise.all([
              this.prisma.exam_marks.findMany({
                where: {
                  exam_subject_mapping: {
                    class_id: { in: classIds },
                    exams: { semester, exam_types: { category: 'external' } },
                  },
                },
                select: {
                  student_id: true,
                  marks_obtained: true,
                  max_marks: true,
                  is_absent: true,
                  exam_subject_mapping: {
                    select: {
                      class_id: true,
                      subject_id: true,
                      subjects: {
                        select: { id: true, name: true, subject_code: true },
                      },
                    },
                  },
                },
              }),
              semester > 1
                ? this.prisma.exam_marks.findMany({
                    where: {
                      exam_subject_mapping: {
                        class_id: { in: classIds },
                        exams: {
                          semester: semester - 1,
                          exam_types: { category: 'external' },
                        },
                      },
                    },
                    select: {
                      student_id: true,
                      marks_obtained: true,
                      max_marks: true,
                      is_absent: true,
                      exam_subject_mapping: {
                        select: { subject_id: true },
                      },
                    },
                  })
                : Promise.resolve([]),
              this.prisma.faculty_subject_class_mapping.findMany({
                where: { class_id: { in: classIds } },
                select: {
                  subject_id: true,
                  faculty: {
                    select: { prefix: true, first_name: true, last_name: true },
                  },
                },
              }),
            ]);

          // One representative teacher per subject for display — a subject
          // can be taught by different faculty across sections, but the
          // reference design shows a single "· Prof. X" per subject row, so
          // this takes whichever assignment is found first.
          const facultyLabelBySubject = new Map<number, string | null>();
          for (const assignment of teachingAssignments) {
            if (!facultyLabelBySubject.has(assignment.subject_id)) {
              facultyLabelBySubject.set(
                assignment.subject_id,
                facultyLabel(assignment.faculty),
              );
            }
          }

          type SubjectRow = (typeof currentRows)[number];
          const bySubject = new Map<
            number,
            {
              name: string;
              code: string;
              faculty_label: string | null;
              bySection: Map<string, SubjectRow[]>;
            }
          >();
          const sectionByClassId = new Map(
            classesInSemester.map((c) => [c.id, c.section]),
          );
          for (const row of currentRows) {
            const subjectId = row.exam_subject_mapping.subject_id;
            const section =
              sectionByClassId.get(row.exam_subject_mapping.class_id) ?? '?';
            const entry = bySubject.get(subjectId) ?? {
              name: row.exam_subject_mapping.subjects.name,
              code: row.exam_subject_mapping.subjects.subject_code,
              faculty_label: facultyLabelBySubject.get(subjectId) ?? null,
              bySection: new Map<string, SubjectRow[]>(),
            };
            const sectionRows = entry.bySection.get(section) ?? [];
            sectionRows.push(row);
            entry.bySection.set(section, sectionRows);
            bySubject.set(subjectId, entry);
          }

          const previousBySubject = new Map<number, typeof previousRows>();
          for (const row of previousRows) {
            const subjectId = row.exam_subject_mapping.subject_id;
            const list = previousBySubject.get(subjectId) ?? [];
            list.push(row);
            previousBySubject.set(subjectId, list);
          }

          const subjects = [...bySubject.entries()].map(([subjectId, s]) => {
            const sections = [...s.bySection.entries()].map(
              ([section, rows]) => ({
                section,
                pass_percent: passPercent(rows),
              }),
            );
            const allCurrentRows = [...s.bySection.values()].flat();
            const average_pass_percent = passPercent(allCurrentRows);
            const previousPass = passPercent(
              previousBySubject.get(subjectId) ?? [],
            );
            const change =
              average_pass_percent !== null && previousPass !== null
                ? Math.round((average_pass_percent - previousPass) * 10) / 10
                : null;
            const belowRemedial = sections
              .filter(
                (sec) => sec.pass_percent !== null && sec.pass_percent < 80,
              )
              .sort(
                (a, b) =>
                  (a.pass_percent as number) - (b.pass_percent as number),
              )[0];
            return {
              subject_id: subjectId,
              name: s.name,
              code: s.code,
              faculty_label: s.faculty_label,
              sections,
              average_pass_percent,
              change_pts: change,
              needs_remedial: belowRemedial !== undefined,
              lowest_section_label: belowRemedial
                ? `${yearLabelForSemester(semester)}-${belowRemedial.section}`
                : null,
            };
          });

          return {
            semester,
            year: yearLabelForSemester(semester),
            sections: [
              ...new Set(classesInSemester.map((c) => c.section)),
            ].sort(),
            subjects,
          };
        }),
    );

    return { groups };
  }

  private async currentSemesterMarks(
    classes: { id: number; current_semester: number | null }[],
  ) {
    const bySemester = new Map<number, number[]>();
    for (const c of classes) {
      if (c.current_semester == null) continue;
      const list = bySemester.get(c.current_semester) ?? [];
      list.push(c.id);
      bySemester.set(c.current_semester, list);
    }
    const all = await Promise.all(
      [...bySemester.entries()].map(([semester, classIds]) =>
        this.prisma.exam_marks.findMany({
          where: {
            exam_subject_mapping: {
              class_id: { in: classIds },
              exams: { semester, exam_types: { category: 'external' } },
            },
          },
          select: {
            student_id: true,
            marks_obtained: true,
            max_marks: true,
            is_absent: true,
            exam_subject_mapping: {
              select: {
                class_id: true,
                subject_id: true,
                subjects: { select: { credits: true } },
              },
            },
          },
        }),
      ),
    );
    return all.flat() as MarkRow[];
  }

  private async previousSemesterMarks(
    classes: { id: number; current_semester: number | null }[],
  ) {
    const bySemester = new Map<number, number[]>();
    for (const c of classes) {
      if (c.current_semester == null || c.current_semester <= 1) continue;
      const prev = c.current_semester - 1;
      const list = bySemester.get(prev) ?? [];
      list.push(c.id);
      bySemester.set(prev, list);
    }
    const all = await Promise.all(
      [...bySemester.entries()].map(([semester, classIds]) =>
        this.prisma.exam_marks.findMany({
          where: {
            exam_subject_mapping: {
              class_id: { in: classIds },
              exams: { semester, exam_types: { category: 'external' } },
            },
          },
          select: {
            student_id: true,
            marks_obtained: true,
            max_marks: true,
            is_absent: true,
            exam_subject_mapping: {
              select: {
                class_id: true,
                subject_id: true,
                subjects: { select: { credits: true } },
              },
            },
          },
        }),
      ),
    );
    return all.flat() as MarkRow[];
  }

  private cgpaPerStudent(rows: MarkRow[]) {
    const byStudent = new Map<number, MarkRow[]>();
    for (const row of rows) {
      const list = byStudent.get(row.student_id) ?? [];
      list.push(row);
      byStudent.set(row.student_id, list);
    }
    const result = new Map<number, number | null>();
    for (const [studentId, studentRows] of byStudent) {
      const gpa = computeGpa(
        studentRows
          .filter((r) => !r.is_absent && r.marks_obtained != null)
          .map((r) => ({
            percentage: toPercentage(r.marks_obtained, r.max_marks),
            credits: r.exam_subject_mapping.subjects.credits,
          })),
      );
      result.set(studentId, gpa);
    }
    return result;
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
  );
}

function countDistinctFailingStudents(rows: MarkRow[]): number {
  const failing = new Set<number>();
  for (const row of rows) {
    if (!row.is_absent && row.marks_obtained == null) continue; // not graded yet
    if (
      row.is_absent ||
      !isPassingPercentage(toPercentage(row.marks_obtained, row.max_marks))
    ) {
      failing.add(row.student_id);
    }
  }
  return failing.size;
}

function facultyLabel(
  faculty: {
    prefix: string | null;
    first_name: string;
    last_name: string;
  } | null,
): string | null {
  if (!faculty) return null;
  return [faculty.prefix, faculty.first_name, faculty.last_name]
    .filter(Boolean)
    .join(' ');
}
