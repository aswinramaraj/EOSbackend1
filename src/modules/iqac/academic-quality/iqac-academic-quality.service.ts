import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalDepartmentsService } from 'src/modules/principal/departments/departments.service';

type GradeBandRow = {
  grade_label: string;
  min_percentage: unknown;
  grade_point: unknown;
  is_pass: boolean;
};

function bandFor(percentage: number, bands: GradeBandRow[]): GradeBandRow {
  for (const b of bands) {
    if (percentage >= Number(b.min_percentage)) return b;
  }
  return bands[bands.length - 1];
}

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Jul–Dec or Jan–Jun of the current calendar year — the same "current term" window PrincipalDepartmentsService uses, so the two stay consistent with each other. */
function currentTermRange(today: Date): { start: Date; end: Date } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
  };
}

/** The same term window, one calendar year earlier — for a real (not fabricated) "last year" comparison. */
function priorYearTermRange(range: { start: Date; end: Date }): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(
      Date.UTC(
        range.start.getUTCFullYear() - 1,
        range.start.getUTCMonth(),
        range.start.getUTCDate(),
      ),
    ),
    end: new Date(
      Date.UTC(
        range.end.getUTCFullYear() - 1,
        range.end.getUTCMonth(),
        range.end.getUTCDate(),
      ),
    ),
  };
}

function meanPercentage(rows: { status: string }[]): number | null {
  if (rows.length === 0) return null;
  const present = rows.filter((r) => r.status === 'present').length;
  return Math.round((present / rows.length) * 1000) / 10;
}

/** 'YYYY-YYYY', Jun cutoff — matches this session's own iqac_metric_targets.sql seed example. */
function currentAcademicYearLabel(today: Date): string {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const start = month >= 6 ? calendarYear : calendarYear - 1;
  return `${start}-${start + 1}`;
}

@Injectable()
export class IqacAcademicQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentsService: PrincipalDepartmentsService,
  ) {}

  /**
   * Real target for one metric, this academic year — from
   * iqac_metric_targets (see iqac_metric_targets.sql). Returns null if the
   * table is empty or has no row for this metric/year yet, same as before
   * the table existed — callers don't need to change.
   */
  private async targetFor(metricKey: string): Promise<number | null> {
    const row = await this.prisma.iqac_metric_targets.findUnique({
      where: {
        metric_key_academic_year: {
          metric_key: metricKey,
          academic_year: currentAcademicYearLabel(startOfToday()),
        },
      },
    });
    return row ? Number(row.target_value) : null;
  }

  /**
   * GET /me/iqac/academic-quality/attendance
   *
   * Mirrors the reference design's "This year / Last year / Target /
   * Attainment" card row and department + class register honestly:
   * this_year and last_year are both real (same term window, one calendar
   * year apart). target/attainment come from the real iqac_metric_targets
   * table now that it exists — still null (rendered as "—") until IQAC
   * sets a row for this academic year.
   */
  async attendance() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);

    const [target, thisTermRows, lastYearRows, departments, classes] =
      await Promise.all([
        this.targetFor('attendance'),
        this.prisma.attendance_records.findMany({
          where: {
            attendance_date: { gte: thisTerm.start, lte: thisTerm.end },
          },
          select: { status: true, attendance_date: true, student_id: true },
        }),
        this.prisma.attendance_records.findMany({
          where: {
            attendance_date: { gte: lastYearTerm.start, lte: lastYearTerm.end },
          },
          select: { status: true, student_id: true },
        }),
        this.departmentsService.list(),
        this.prisma.classes.findMany({
          select: {
            id: true,
            section: true,
            current_semester: true,
            departments: { select: { code: true, name: true } },
            batches: { select: { name: true } },
            class_mentors: {
              orderBy: { id: 'desc' },
              take: 1,
              select: {
                faculty: { select: { first_name: true, last_name: true } },
              },
            },
            students: { where: { status: 'active' }, select: { id: true } },
          },
          orderBy: [{ department_id: 'asc' }, { section: 'asc' }],
        }),
      ]);

    const ATTENDANCE_THRESHOLD_PERCENT = 75;
    const byStudentThisTerm = new Map<
      number,
      { present: number; total: number }
    >();
    const byMonth = new Map<string, { present: number; total: number }>();
    for (const r of thisTermRows) {
      const s = byStudentThisTerm.get(r.student_id) ?? {
        present: 0,
        total: 0,
      };
      s.total += 1;
      if (r.status === 'present') s.present += 1;
      byStudentThisTerm.set(r.student_id, s);

      const monthKey = r.attendance_date.toISOString().slice(0, 7);
      const m = byMonth.get(monthKey) ?? { present: 0, total: 0 };
      m.total += 1;
      if (r.status === 'present') m.present += 1;
      byMonth.set(monthKey, m);
    }
    const byStudentLastYear = new Map<
      number,
      { present: number; total: number }
    >();
    for (const r of lastYearRows) {
      const s = byStudentLastYear.get(r.student_id) ?? {
        present: 0,
        total: 0,
      };
      s.total += 1;
      if (r.status === 'present') s.present += 1;
      byStudentLastYear.set(r.student_id, s);
    }

    let studentsBelowThreshold = 0;
    for (const s of byStudentThisTerm.values()) {
      if (
        s.total > 0 &&
        (s.present / s.total) * 100 < ATTENDANCE_THRESHOLD_PERCENT
      )
        studentsBelowThreshold += 1;
    }

    const trend = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({
        month: new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-IN', {
          month: 'short',
          timeZone: 'UTC',
        }),
        percentage:
          v.total > 0 ? Math.round((v.present / v.total) * 1000) / 10 : null,
        marked: v.total,
      }));

    const percentFromIds = (
      studentIds: number[],
      byStudent: Map<number, { present: number; total: number }>,
    ): number | null => {
      let present = 0;
      let total = 0;
      for (const id of studentIds) {
        const e = byStudent.get(id);
        if (e) {
          present += e.present;
          total += e.total;
        }
      }
      return total > 0 ? Math.round((present / total) * 1000) / 10 : null;
    };

    const register = classes.map((c) => {
      const studentIds = c.students.map((s) => s.id);
      const advisor = c.class_mentors[0]?.faculty ?? null;
      const classThisYear = percentFromIds(studentIds, byStudentThisTerm);
      return {
        class_id: c.id,
        department_code: c.departments.code,
        department_name: c.departments.name,
        section: c.section,
        batch_label: c.batches.name,
        semester: c.current_semester,
        class_advisor: advisor
          ? `${advisor.first_name} ${advisor.last_name}`
          : null,
        this_year: classThisYear,
        last_year: percentFromIds(studentIds, byStudentLastYear),
        target,
        attainment:
          target != null && classThisYear != null
            ? Math.round((classThisYear / target) * 1000) / 10
            : null,
      };
    });

    const institutionThisYear = meanPercentage(thisTermRows);

    return {
      this_year: institutionThisYear,
      last_year: meanPercentage(lastYearRows),
      target,
      attainment:
        target != null && institutionThisYear != null
          ? Math.round((institutionThisYear / target) * 1000) / 10
          : null,
      marked_total: thisTermRows.length,
      students_below_threshold: studentsBelowThreshold,
      threshold_percentage: ATTENDANCE_THRESHOLD_PERCENT,
      trend,
      departments: departments.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        attendance_percentage: d.attendance_percentage,
        students_count: d.students_count,
      })),
      register,
    };
  }

  /**
   * The most recent real exam that actually has subjects mapped to it —
   * optionally scoped to one real batch. Replaces manual batch/semester/exam
   * picking on Results and Grade distribution: those pages now just take a
   * batch (or none, for "latest overall"), and this resolves the one real
   * exam instance behind it, same as before, just without the extra clicks.
   */
  private async latestExamId(batchId?: number): Promise<number | null> {
    const exam = await this.prisma.exams.findFirst({
      where: {
        ...(batchId != null ? { batch_id: batchId } : {}),
        exam_subject_mapping: { some: {} },
      },
      orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
      select: { id: true },
    });
    return exam?.id ?? null;
  }

  /**
   * GET /me/iqac/academic-quality/results?batch_id=
   *
   * Subject-wise pass rate for the latest real exam for the given batch (or
   * the latest exam overall if no batch is given), aggregated across every
   * class that sat it. "Appeared" = a graded, non-absent exam_marks row (a
   * student who didn't sit or whose marks aren't entered yet is neither a
   * pass nor a fail). "Failed" is this exam's own pass/fail split via
   * grade_bands, not the broader "arrears" concept — the codebase's own
   * exams.service.ts documents why a felt-real "arrears" total isn't
   * computable, and that limitation is unrelated to this simpler,
   * per-exam number.
   */
  async results(batchId?: number, section?: string) {
    const examId = await this.latestExamId(batchId);
    if (examId == null) {
      return {
        exam: null,
        overall_pass_percentage: null,
        target: await this.targetFor('results'),
        attainment: null,
        candidate_appearances: 0,
        subject_count: 0,
        subjects: [],
        departments: [],
        sections: [],
      };
    }

    const exam = await this.prisma.exams.findUnique({
      where: { id: examId },
      select: {
        title: true,
        academic_year: true,
        semester: true,
        exam_types: { select: { name: true } },
      },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId },
      select: {
        id: true,
        subject_id: true,
        subjects: {
          select: {
            subject_code: true,
            name: true,
            department_id: true,
            departments: { select: { code: true, name: true } },
          },
        },
      },
    });
    const mappingIds = mappings.map((m) => m.id);
    const mappingToSubject = new Map(mappings.map((m) => [m.id, m.subject_id]));
    const subjectInfo = new Map(
      mappings.map((m) => [
        m.subject_id,
        {
          code: m.subjects.subject_code,
          name: m.subjects.name,
          departmentId: m.subjects.department_id,
          departmentCode: m.subjects.departments?.code ?? null,
          departmentName: m.subjects.departments?.name ?? null,
        },
      ]),
    );

    const allMarks = mappingIds.length
      ? await this.prisma.exam_marks.findMany({
          where: { exam_subject_mapping_id: { in: mappingIds } },
          select: {
            exam_subject_mapping_id: true,
            marks_obtained: true,
            max_marks: true,
            is_absent: true,
            students: { select: { classes: { select: { section: true } } } },
          },
        })
      : [];

    // Real, from every candidate's own class section — unfiltered, so the
    // dropdown always lists every section that actually sat this exam, not
    // just the ones surviving the current section filter.
    const sections = Array.from(
      new Set(
        allMarks
          .map((mk) => mk.students.classes?.section)
          .filter((s): s is string => !!s),
      ),
    ).sort();

    const marks = section
      ? allMarks.filter((mk) => mk.students.classes?.section === section)
      : allMarks;

    const bands = await this.prisma.grade_bands.findMany({
      orderBy: { display_order: 'asc' },
    });

    const bySubject = new Map<number, { appeared: number; passed: number }>();
    for (const mk of marks) {
      if (mk.is_absent || mk.marks_obtained == null) continue;
      const subjectId = mappingToSubject.get(mk.exam_subject_mapping_id);
      if (subjectId == null) continue;
      const pct = (Number(mk.marks_obtained) / Number(mk.max_marks)) * 100;
      const isPass = bandFor(pct, bands).is_pass;
      const entry = bySubject.get(subjectId) ?? { appeared: 0, passed: 0 };
      entry.appeared += 1;
      if (isPass) entry.passed += 1;
      bySubject.set(subjectId, entry);
    }

    const subjects = [...bySubject.entries()]
      .map(([subjectId, v]) => {
        const info = subjectInfo.get(subjectId)!;
        return {
          subject_code: info.code,
          name: info.name,
          department_id: info.departmentId,
          appeared: v.appeared,
          passed: v.passed,
          failed: v.appeared - v.passed,
          pass_percentage:
            v.appeared > 0
              ? Math.round((v.passed / v.appeared) * 1000) / 10
              : null,
        };
      })
      .sort((a, b) => a.subject_code.localeCompare(b.subject_code));

    const totalAppeared = subjects.reduce((a, r) => a + r.appeared, 0);
    const totalPassed = subjects.reduce((a, r) => a + r.passed, 0);

    const byDept = new Map<number, { appeared: number; passed: number }>();
    for (const [subjectId, v] of bySubject.entries()) {
      const info = subjectInfo.get(subjectId)!;
      if (info.departmentId == null) continue;
      const entry = byDept.get(info.departmentId) ?? { appeared: 0, passed: 0 };
      entry.appeared += v.appeared;
      entry.passed += v.passed;
      byDept.set(info.departmentId, entry);
    }
    const departments = [...byDept.entries()]
      .map(([deptId, v]) => {
        const info = [...subjectInfo.values()].find(
          (s) => s.departmentId === deptId,
        )!;
        return {
          id: deptId,
          code: info.departmentCode,
          name: info.departmentName,
          appeared: v.appeared,
          passed: v.passed,
          pass_percentage:
            v.appeared > 0
              ? Math.round((v.passed / v.appeared) * 1000) / 10
              : null,
        };
      })
      .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));

    const target = await this.targetFor('results');
    const overallPassPercentage =
      totalAppeared > 0
        ? Math.round((totalPassed / totalAppeared) * 1000) / 10
        : null;

    return {
      exam: {
        title: exam.title,
        academic_year: exam.academic_year,
        semester: exam.semester,
        type: exam.exam_types?.name ?? null,
      },
      overall_pass_percentage: overallPassPercentage,
      target,
      attainment:
        target != null && overallPassPercentage != null
          ? Math.round((overallPassPercentage / target) * 1000) / 10
          : null,
      candidate_appearances: totalAppeared,
      subject_count: subjects.length,
      subjects,
      departments,
      sections,
    };
  }

  /**
   * GET /me/iqac/academic-quality/grade-distribution?batch_id=
   *
   * The reference design calls this metric "CGPA" — not computable here
   * (documented in principal/exams/exams.service.ts and shown as a literal
   * "—" throughout the People-section pages): exam_marks has no
   * internal/external split and max_marks is inconsistently 50 or 100, so
   * no single composite pass/fail — let alone a credit-weighted CGPA — can
   * be recovered per subject. What IS real: every individual exam_marks
   * row for one exam can be graded via grade_bands, so this returns a
   * grade-band distribution for the latest real exam for the given batch
   * (or the latest exam overall) instead of a fabricated CGPA figure.
   */
  async gradeDistribution(batchId?: number) {
    const examId = await this.latestExamId(batchId);
    if (examId == null) {
      return {
        exam: null,
        graded_attempts: 0,
        mean_grade_point: null,
        target: await this.targetFor('cgpa'),
        attainment: null,
        distribution: [],
        departments: [],
        register: [],
      };
    }

    const exam = await this.prisma.exams.findUnique({
      where: { id: examId },
      select: { title: true, academic_year: true, semester: true },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId },
      select: {
        id: true,
        classes: {
          select: {
            id: true,
            section: true,
            current_semester: true,
            department_id: true,
            departments: { select: { code: true, name: true } },
            batches: { select: { name: true } },
            class_mentors: {
              orderBy: { id: 'desc' },
              take: 1,
              select: {
                faculty: { select: { first_name: true, last_name: true } },
              },
            },
          },
        },
      },
    });
    const mappingIds = mappings.map((m) => m.id);
    const mappingToClass = new Map(mappings.map((m) => [m.id, m.classes]));

    const marks = mappingIds.length
      ? await this.prisma.exam_marks.findMany({
          where: { exam_subject_mapping_id: { in: mappingIds } },
          select: {
            exam_subject_mapping_id: true,
            marks_obtained: true,
            max_marks: true,
            is_absent: true,
          },
        })
      : [];

    const bands = await this.prisma.grade_bands.findMany({
      orderBy: { display_order: 'asc' },
    });

    const counts = new Map<string, number>(
      bands.map((b) => [b.grade_label, 0]),
    );
    let gradedTotal = 0;
    let gradePointSum = 0;
    let gradePointCount = 0;
    const byClass = new Map<number, { sum: number; count: number }>();
    const byDept = new Map<number, { sum: number; count: number }>();
    for (const mk of marks) {
      if (mk.is_absent || mk.marks_obtained == null) continue;
      const pct = (Number(mk.marks_obtained) / Number(mk.max_marks)) * 100;
      const band = bandFor(pct, bands);
      counts.set(band.grade_label, (counts.get(band.grade_label) ?? 0) + 1);
      gradedTotal += 1;
      if (band.grade_point == null) continue;
      const gp = Number(band.grade_point);
      gradePointSum += gp;
      gradePointCount += 1;

      const cls = mappingToClass.get(mk.exam_subject_mapping_id);
      if (!cls) continue;
      const classEntry = byClass.get(cls.id) ?? { sum: 0, count: 0 };
      classEntry.sum += gp;
      classEntry.count += 1;
      byClass.set(cls.id, classEntry);

      const deptEntry = byDept.get(cls.department_id) ?? { sum: 0, count: 0 };
      deptEntry.sum += gp;
      deptEntry.count += 1;
      byDept.set(cls.department_id, deptEntry);
    }

    const distribution = bands.map((b) => ({
      grade_label: b.grade_label,
      is_pass: b.is_pass,
      count: counts.get(b.grade_label) ?? 0,
      share_percentage:
        gradedTotal > 0
          ? Math.round(
              ((counts.get(b.grade_label) ?? 0) / gradedTotal) * 1000,
            ) / 10
          : 0,
    }));

    const target = await this.targetFor('cgpa');
    const classById = new Map(mappings.map((m) => [m.classes.id, m.classes]));
    const register = [...byClass.entries()]
      .map(([classId, v]) => {
        const cls = classById.get(classId)!;
        const classMeanGp =
          v.count > 0 ? Math.round((v.sum / v.count) * 100) / 100 : null;
        const advisor = cls.class_mentors[0]?.faculty ?? null;
        return {
          class_id: classId,
          department_code: cls.departments.code,
          department_name: cls.departments.name,
          section: cls.section,
          batch_label: cls.batches.name,
          semester: cls.current_semester,
          class_advisor: advisor
            ? `${advisor.first_name} ${advisor.last_name}`
            : null,
          mean_grade_point: classMeanGp,
          target,
          attainment:
            target != null && classMeanGp != null
              ? Math.round((classMeanGp / target) * 1000) / 10
              : null,
        };
      })
      .sort(
        (a, b) =>
          a.department_code.localeCompare(b.department_code) ||
          a.section.localeCompare(b.section),
      );

    const departments = [...byDept.entries()]
      .map(([deptId, v]) => {
        const cls = [...mappingToClass.values()].find(
          (c) => c?.department_id === deptId,
        )!;
        return {
          id: deptId,
          code: cls.departments.code,
          name: cls.departments.name,
          mean_grade_point:
            v.count > 0 ? Math.round((v.sum / v.count) * 100) / 100 : null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const institutionMeanGp =
      gradePointCount > 0
        ? Math.round((gradePointSum / gradePointCount) * 100) / 100
        : null;

    return {
      exam: {
        title: exam.title,
        academic_year: exam.academic_year,
        semester: exam.semester,
      },
      graded_attempts: gradedTotal,
      mean_grade_point: institutionMeanGp,
      target,
      attainment:
        target != null && institutionMeanGp != null
          ? Math.round((institutionMeanGp / target) * 1000) / 10
          : null,
      distribution,
      departments,
      register,
    };
  }

  /**
   * GET /me/iqac/academic-quality/course-attainment?department_id=&batch_id=
   *
   * course_outcomes/outcome_attainments now exist (they didn't when this
   * page first shipped — see prisma/migrations/iqac_outcome_attainment.sql).
   * Direct/indirect/target/attained are shown exactly as entered — no
   * attainment formula is invented here; a CO with no outcome_attainments
   * row yet shows "—" for all four, not a guess. When batchId is given, the
   * real outcome_attainments.batch_id column picks that batch's own entry
   * instead of the latest across any batch.
   */
  async courseAttainment(departmentId?: number, batchId?: number) {
    const outcomes = await this.prisma.course_outcomes.findMany({
      where:
        departmentId != null
          ? { subjects: { department_id: departmentId } }
          : undefined,
      include: {
        subjects: {
          select: {
            subject_code: true,
            name: true,
            departments: { select: { id: true, code: true, name: true } },
          },
        },
        outcome_attainments: {
          where: batchId != null ? { batch_id: batchId } : undefined,
          orderBy: { academic_year: 'desc' },
          take: 1,
        },
      },
      orderBy: { code: 'asc' },
    });

    const rows = outcomes.map((o) => {
      const latest = o.outcome_attainments[0] ?? null;
      return {
        id: o.id,
        code: o.code,
        description: o.description,
        subject_code: o.subjects.subject_code,
        subject_name: o.subjects.name,
        department: o.subjects.departments,
        direct:
          latest?.direct_value != null ? Number(latest.direct_value) : null,
        indirect:
          latest?.indirect_value != null ? Number(latest.indirect_value) : null,
        target: latest ? Number(latest.target_value) : null,
        attained:
          latest?.attained_value != null ? Number(latest.attained_value) : null,
      };
    });

    const withAttained = rows.filter((r) => r.attained != null);
    const meanAttained =
      withAttained.length > 0
        ? Math.round(
            (withAttained.reduce((sum, r) => sum + r.attained!, 0) /
              withAttained.length) *
              100,
          ) / 100
        : null;
    const withTarget = rows.filter((r) => r.target != null);
    const meanTarget =
      withTarget.length > 0
        ? Math.round(
            (withTarget.reduce((sum, r) => sum + r.target!, 0) /
              withTarget.length) *
              100,
          ) / 100
        : null;

    return {
      outcomes: rows,
      tracked_count: rows.length,
      recorded_count: withAttained.length,
      mean_attained: meanAttained,
      // Real mean of every tracked outcome's own target_value — this domain
      // has no institution-wide iqac_metric_targets entry (each CO carries
      // its own real target instead), matching the page's own card.
      mean_target: meanTarget,
      attainment_percentage:
        meanTarget != null && meanAttained != null
          ? Math.round((meanAttained / meanTarget) * 1000) / 10
          : null,
    };
  }

  /**
   * GET /me/iqac/academic-quality/program-attainment?department_id=&batch_id=
   * Same honesty rule as courseAttainment(): values shown exactly as
   * entered, "—" (null) where no outcome_attainments row exists yet.
   */
  async programAttainment(departmentId?: number, batchId?: number) {
    const outcomes = await this.prisma.program_outcomes.findMany({
      where: departmentId != null ? { department_id: departmentId } : undefined,
      include: {
        departments: { select: { id: true, code: true, name: true } },
        outcome_attainments: {
          where: batchId != null ? { batch_id: batchId } : undefined,
          orderBy: { academic_year: 'desc' },
          take: 1,
        },
      },
      orderBy: { code: 'asc' },
    });

    const rows = outcomes.map((o) => {
      const latest = o.outcome_attainments[0] ?? null;
      return {
        id: o.id,
        code: o.code,
        description: o.description,
        department: o.departments,
        direct:
          latest?.direct_value != null ? Number(latest.direct_value) : null,
        indirect:
          latest?.indirect_value != null ? Number(latest.indirect_value) : null,
        target: latest ? Number(latest.target_value) : null,
        attained:
          latest?.attained_value != null ? Number(latest.attained_value) : null,
      };
    });

    const withAttained = rows.filter((r) => r.attained != null);
    const meanAttained =
      withAttained.length > 0
        ? Math.round(
            (withAttained.reduce((sum, r) => sum + r.attained!, 0) /
              withAttained.length) *
              100,
          ) / 100
        : null;

    const withTarget = rows.filter((r) => r.target != null);
    const meanTarget =
      withTarget.length > 0
        ? Math.round(
            (withTarget.reduce((sum, r) => sum + r.target!, 0) /
              withTarget.length) *
              100,
          ) / 100
        : null;

    return {
      outcomes: rows,
      tracked_count: rows.length,
      recorded_count: withAttained.length,
      mean_attained: meanAttained,
      mean_target: meanTarget,
      attainment_percentage:
        meanTarget != null && meanAttained != null
          ? Math.round((meanAttained / meanTarget) * 1000) / 10
          : null,
    };
  }
}
