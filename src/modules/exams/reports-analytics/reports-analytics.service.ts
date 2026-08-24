import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface StudentStat {
  departmentId: number;
  classId: number;
  sum: number;
  maxSum: number;
  arrears: number;
  creditWeightedSum: number;
  creditsAttempted: number;
}

interface SubjectAgg {
  subjectId: number;
  code: string;
  name: string;
  appeared: number;
  pass: number;
  gradeSum: number;
  gradeCount: number;
}

interface CycleStats {
  examId: number;
  examLabel: string;
  academicYear: string;
  semester: number;
  examTypeId: number;
  candidatesEvaluated: number;
  passCount: number;
  passPercentage: number | null;
  arrearRate: number | null;
  distinctionCount: number;
  averageCgpa: number | null;
  departmentBreakdown: {
    code: string;
    passPercentage: number;
    candidates: number;
  }[];
  subjectPerformance: {
    subjectId: number;
    code: string;
    name: string;
    appeared: number;
    passPercentage: number;
    avgGpa: number | null;
  }[];
  arrearBuckets: {
    one: number;
    twoToThree: number;
    fourToFive: number;
    sixPlus: number;
  };
  finalYearArrears: number;
  valuationCompletedPercentage: number;
  feeCollectionPercentage: number;
}

/**
 * A single `exams` row already spans every department/class mapped to it
 * (exam_subject_mapping has no department scoping of its own), so one
 * exam_id genuinely represents one whole examination cycle — no new
 * "cycle" concept needed. Everything here is a real aggregate over
 * exam_marks/exam_subject_mapping/grade_bands/script_bundles/
 * exam_registrations; nothing is fabricated.
 */
@Injectable()
export class ReportsAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same real internal+external join used by marks-roster/course-results/student-exam-record. */
  private async findInternalMapping(
    classId: number,
    subjectId: number,
    academicYear: string,
    semester: number,
    excludeMappingId: number,
  ) {
    return this.prisma.exam_subject_mapping.findFirst({
      where: {
        class_id: classId,
        subject_id: subjectId,
        id: { not: excludeMappingId },
        exams: {
          academic_year: academicYear,
          semester,
          exam_types: { category: 'internal' },
        },
      },
      orderBy: { exam_id: 'desc' },
      select: { id: true },
    });
  }

  private async computeCycle(examId: number): Promise<CycleStats> {
    const exam = await this.prisma.exams.findUnique({
      where: { id: examId },
      include: { exam_types: { select: { name: true, category: true } } },
    });
    if (!exam)
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });

    const [passRules, gradeBandsDesc, mappings] = await Promise.all([
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.grade_bands.findMany({ orderBy: { min_percentage: 'desc' } }),
      this.prisma.exam_subject_mapping.findMany({
        where: { exam_id: examId },
        select: {
          id: true,
          class_id: true,
          subject_id: true,
          subjects: {
            select: { subject_code: true, name: true, credits: true },
          },
          classes: {
            select: {
              department_id: true,
              departments: { select: { code: true } },
            },
          },
        },
      }),
    ]);

    const passMark = passRules ? Number(passRules.pass_mark_total) : 50;
    const topBandMin = gradeBandsDesc[0]
      ? Number(gradeBandsDesc[0].min_percentage)
      : null;
    const examLabel = `${exam.exam_types.name} · Semester ${exam.semester} · ${exam.academic_year}`;

    const base: CycleStats = {
      examId,
      examLabel,
      academicYear: exam.academic_year,
      semester: exam.semester,
      examTypeId: exam.exam_type_id,
      candidatesEvaluated: 0,
      passCount: 0,
      passPercentage: null,
      arrearRate: null,
      distinctionCount: 0,
      averageCgpa: null,
      departmentBreakdown: [],
      subjectPerformance: [],
      arrearBuckets: { one: 0, twoToThree: 0, fourToFive: 0, sixPlus: 0 },
      finalYearArrears: 0,
      valuationCompletedPercentage: 0,
      feeCollectionPercentage: 0,
    };

    if (mappings.length === 0) return base;

    const mappingIds = mappings.map((m) => m.id);
    const [externalMarks, registrations, scriptsTotal, scriptsValued] =
      await Promise.all([
        this.prisma.exam_marks.findMany({
          where: { exam_subject_mapping_id: { in: mappingIds } },
        }),
        this.prisma.exam_registrations.findMany({
          where: { exam_id: examId },
          select: { fee_status: true },
        }),
        this.prisma.script_bundle_scripts.count({
          where: {
            script_bundles: { exam_subject_mapping: { exam_id: examId } },
          },
        }),
        this.prisma.script_bundle_marks.count({
          where: {
            OR: [{ total_marks: { not: null } }, { is_absent: true }],
            script_bundles: { exam_subject_mapping: { exam_id: examId } },
          },
        }),
      ]);

    base.valuationCompletedPercentage =
      scriptsTotal > 0
        ? Math.round((scriptsValued / scriptsTotal) * 1000) / 10
        : 0;
    base.feeCollectionPercentage =
      registrations.length > 0
        ? Math.round(
            (registrations.filter((r) => r.fee_status === 'paid').length /
              registrations.length) *
              1000,
          ) / 10
        : 0;

    const internalMappingByKey = new Map<string, number | null>();
    if (exam.exam_types.category !== 'internal') {
      for (const m of mappings) {
        const key = `${m.class_id}|${m.subject_id}`;
        if (!internalMappingByKey.has(key)) {
          const im = await this.findInternalMapping(
            m.class_id,
            m.subject_id,
            exam.academic_year,
            exam.semester,
            m.id,
          );
          internalMappingByKey.set(key, im?.id ?? null);
        }
      }
    }
    const internalMappingIds = [
      ...new Set(
        [...internalMappingByKey.values()].filter(
          (id): id is number => id != null,
        ),
      ),
    ];
    const internalMarks = internalMappingIds.length
      ? await this.prisma.exam_marks.findMany({
          where: { exam_subject_mapping_id: { in: internalMappingIds } },
        })
      : [];
    const internalByKey = new Map(
      internalMarks.map((m) => [
        `${m.exam_subject_mapping_id}|${m.student_id}`,
        m,
      ]),
    );

    const classIds = [...new Set(mappings.map((m) => m.class_id))];
    const classRows = await this.prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: {
        id: true,
        current_semester: true,
        courses: { select: { duration_years: true } },
      },
    });
    const finalYearClassIds = new Set(
      classRows
        .filter(
          (c) =>
            c.current_semester != null &&
            c.current_semester > (c.courses.duration_years - 1) * 2,
        )
        .map((c) => c.id),
    );

    const studentStats = new Map<number, StudentStat>();
    const subjectAgg = new Map<number, SubjectAgg>();

    for (const m of mappings) {
      const credits = m.subjects.credits ?? 0;
      const internalMappingId =
        internalMappingByKey.get(`${m.class_id}|${m.subject_id}`) ?? null;
      const rows = externalMarks.filter(
        (e) => e.exam_subject_mapping_id === m.id,
      );
      // Keyed by subject_id, not mapping id — the same subject taught to
      // more than one class in this exam (multiple sections) must combine
      // into one row, not one row per class (which also produced duplicate
      // React keys downstream since several rows shared the same subjectId).
      const subj = subjectAgg.get(m.subject_id) ?? {
        subjectId: m.subject_id,
        code: m.subjects.subject_code,
        name: m.subjects.name,
        appeared: 0,
        pass: 0,
        gradeSum: 0,
        gradeCount: 0,
      };
      subjectAgg.set(m.subject_id, subj);

      for (const ext of rows) {
        if (ext.is_absent) continue;
        const externalScore =
          ext.marks_obtained != null ? Number(ext.marks_obtained) : null;
        if (externalScore == null) continue;

        let total: number;
        let maxTotal: number;
        if (exam.exam_types.category !== 'internal') {
          const internal =
            internalMappingId != null
              ? internalByKey.get(`${internalMappingId}|${ext.student_id}`)
              : undefined;
          const internalScore =
            internal?.marks_obtained != null
              ? Number(internal.marks_obtained)
              : null;
          if (internalScore == null) continue;
          total = externalScore + internalScore;
          maxTotal = Number(ext.max_marks) + Number(internal!.max_marks);
        } else {
          total = externalScore;
          maxTotal = Number(ext.max_marks);
        }

        const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
        const isPass = total >= passMark;
        const gradeBand =
          gradeBandsDesc.find((b) => pct >= Number(b.min_percentage)) ?? null;
        const gradePoint =
          gradeBand?.grade_point != null ? Number(gradeBand.grade_point) : null;

        subj.appeared += 1;
        if (isPass) subj.pass += 1;
        if (gradePoint != null) {
          subj.gradeSum += gradePoint;
          subj.gradeCount += 1;
        }

        const stat = studentStats.get(ext.student_id) ?? {
          departmentId: m.classes.department_id,
          classId: m.class_id,
          sum: 0,
          maxSum: 0,
          arrears: 0,
          creditWeightedSum: 0,
          creditsAttempted: 0,
        };
        stat.sum += total;
        stat.maxSum += maxTotal;
        if (!isPass) stat.arrears += 1;
        stat.creditsAttempted += credits;
        if (gradePoint != null) stat.creditWeightedSum += gradePoint * credits;
        studentStats.set(ext.student_id, stat);
      }
    }

    const statsList = [...studentStats.values()];
    base.candidatesEvaluated = statsList.length;
    base.passCount = statsList.filter((s) => s.arrears === 0).length;
    base.passPercentage =
      base.candidatesEvaluated > 0
        ? Math.round((base.passCount / base.candidatesEvaluated) * 1000) / 10
        : null;
    base.arrearRate =
      base.passPercentage != null
        ? Math.round((100 - base.passPercentage) * 10) / 10
        : null;

    if (topBandMin != null) {
      base.distinctionCount = statsList.filter(
        (s) => s.maxSum > 0 && (s.sum / s.maxSum) * 100 >= topBandMin,
      ).length;
    }

    for (const s of statsList) {
      if (s.arrears === 1) base.arrearBuckets.one += 1;
      else if (s.arrears >= 2 && s.arrears <= 3)
        base.arrearBuckets.twoToThree += 1;
      else if (s.arrears >= 4 && s.arrears <= 5)
        base.arrearBuckets.fourToFive += 1;
      else if (s.arrears >= 6) base.arrearBuckets.sixPlus += 1;
    }
    base.finalYearArrears = statsList.filter(
      (s) => s.arrears > 0 && finalYearClassIds.has(s.classId),
    ).length;

    const deptMap = new Map<
      number,
      { code: string; pass: number; total: number }
    >();
    for (const s of statsList) {
      const mapping = mappings.find(
        (m) => m.classes.department_id === s.departmentId,
      );
      const code = mapping?.classes.departments.code ?? 'UNK';
      const d = deptMap.get(s.departmentId) ?? { code, pass: 0, total: 0 };
      d.total += 1;
      if (s.arrears === 0) d.pass += 1;
      deptMap.set(s.departmentId, d);
    }
    base.departmentBreakdown = [...deptMap.values()]
      .map((d) => ({
        code: d.code,
        passPercentage:
          d.total > 0 ? Math.round((d.pass / d.total) * 1000) / 10 : 0,
        candidates: d.total,
      }))
      .sort((a, b) => b.passPercentage - a.passPercentage);

    base.subjectPerformance = [...subjectAgg.values()]
      .map((s) => ({
        subjectId: s.subjectId,
        code: s.code,
        name: s.name,
        appeared: s.appeared,
        passPercentage:
          s.appeared > 0 ? Math.round((s.pass / s.appeared) * 1000) / 10 : 0,
        avgGpa:
          s.gradeCount > 0
            ? Math.round((s.gradeSum / s.gradeCount) * 100) / 100
            : null,
      }))
      .sort((a, b) => b.appeared - a.appeared);

    const cgpaList = statsList
      .map((s) =>
        s.creditsAttempted > 0
          ? s.creditWeightedSum / s.creditsAttempted
          : null,
      )
      .filter((v): v is number => v != null);
    base.averageCgpa =
      cgpaList.length > 0
        ? Math.round(
            (cgpaList.reduce((a, b) => a + b, 0) / cgpaList.length) * 100,
          ) / 100
        : null;

    return base;
  }

  /**
   * GET /reports-analytics/summary?exam_id=
   * "Previous cycle" = the most recent earlier exam of the same
   * exam_type_id (id-ordered, same convention every other page in this
   * module uses as a stand-in for chronology). Trend = up to the 6 most
   * recent exams of that same type, current one included.
   */
  async getSummary(examId: number) {
    const current = await this.computeCycle(examId);

    const priorExams = await this.prisma.exams.findMany({
      where: { exam_type_id: current.examTypeId, id: { lt: examId } },
      orderBy: { id: 'desc' },
      take: 5,
      select: { id: true },
    });
    const previousExamId = priorExams[0]?.id ?? null;
    const previous =
      previousExamId != null ? await this.computeCycle(previousExamId) : null;

    const trendExamIds = [...priorExams.map((e) => e.id).reverse(), examId];
    const trend = await Promise.all(
      trendExamIds.map(async (id) => {
        const cycle =
          id === examId
            ? current
            : id === previousExamId
              ? previous!
              : await this.computeCycle(id);
        return {
          examId: id,
          label: `${cycle.academicYear} S${cycle.semester}`,
          passPercentage: cycle.passPercentage,
        };
      }),
    );

    const previousDeptByCode = new Map(
      (previous?.departmentBreakdown ?? []).map((d) => [
        d.code,
        d.passPercentage,
      ]),
    );
    const departmentComparison = current.departmentBreakdown.map((d) => ({
      code: d.code,
      candidates: d.candidates,
      currentPassPercentage: d.passPercentage,
      previousPassPercentage: previousDeptByCode.get(d.code) ?? null,
    }));

    const previousSubjectById = new Map(
      (previous?.subjectPerformance ?? []).map((s) => [
        s.subjectId,
        s.passPercentage,
      ]),
    );
    const subjectPerformance = current.subjectPerformance.map((s) => {
      const prevPct = previousSubjectById.get(s.subjectId);
      return {
        ...s,
        trendDelta:
          prevPct != null
            ? Math.round((s.passPercentage - prevPct) * 10) / 10
            : null,
      };
    });

    return {
      exam: { id: current.examId, label: current.examLabel },
      overallPassPercentage: current.passPercentage,
      overallPassPercentageDelta:
        previous?.passPercentage != null && current.passPercentage != null
          ? Math.round(
              (current.passPercentage - previous.passPercentage) * 10,
            ) / 10
          : null,
      studentsWithDistinction: current.distinctionCount,
      studentsWithDistinctionPercentage:
        current.candidatesEvaluated > 0
          ? Math.round(
              (current.distinctionCount / current.candidatesEvaluated) * 1000,
            ) / 10
          : null,
      averageCgpa: current.averageCgpa,
      arrearRate: current.arrearRate,
      arrearRateDelta:
        previous?.arrearRate != null && current.arrearRate != null
          ? Math.round((current.arrearRate - previous.arrearRate) * 10) / 10
          : null,
      departmentComparison,
      passPercentageTrend: trend,
      subjectPerformance,
      arrearAnalysis: {
        buckets: [
          { label: '1 arrear', count: current.arrearBuckets.one },
          { label: '2-3 arrears', count: current.arrearBuckets.twoToThree },
          { label: '4-5 arrears', count: current.arrearBuckets.fourToFive },
          { label: '6+ arrears', count: current.arrearBuckets.sixPlus },
        ],
        finalYearArrears: current.finalYearArrears,
        valuationCompletedPercentage: current.valuationCompletedPercentage,
        feeCollectionPercentage: current.feeCollectionPercentage,
        resultComparisonDelta:
          previous?.passPercentage != null && current.passPercentage != null
            ? Math.round(
                (current.passPercentage - previous.passPercentage) * 10,
              ) / 10
            : null,
      },
    };
  }
}
