import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MarksRosterQueryDto } from './dto/marks-roster-query.dto';
import { GradeMatrixQueryDto } from './dto/grade-matrix-query.dto';
import { DepartmentCompletionQueryDto } from './dto/department-completion-query.dto';
import { ResultsSummaryQueryDto } from './dto/results-summary-query.dto';
import { CourseMarkStatusQueryDto } from './dto/course-mark-status-query.dto';
import { VerifyMappingMarksDto } from './dto/verify-mapping-marks.dto';

// No `grade_bands` table exists anywhere in the schema (flagged in query.md
// as a genuinely-missing, purely optional table) — grading bands are a
// documented frontend-ish constant here, same thresholds already shown as
// read-only on the Settings page. The marks themselves are always real.
const GRADE_BANDS: { grade: string; min: number }[] = [
  { grade: 'O', min: 91 },
  { grade: 'A+', min: 81 },
  { grade: 'A', min: 71 },
  { grade: 'B+', min: 61 },
  { grade: 'B', min: 50 },
];

function gradeFor(total: number | null): string | null {
  if (total == null) return null;
  for (const band of GRADE_BANDS) {
    if (total >= band.min) return band.grade;
  }
  return 'U';
}

function studentName(soa: { first_name: string; last_name: string | null } | null): string | null {
  if (!soa) return null;
  return [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || null;
}

function facultyDisplayName(f: { prefix?: string | null; first_name: string; last_name: string }): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

type CourseMarkType = 'internal' | 'external' | 'practical';
type CourseMarkRowStatus = 'not_started' | 'in_progress' | 'submitted' | 'verified' | 'locked';

const STUDENT_SELECT = {
  id: true,
  register_no: true,
  roll_no: true,
  student_id_no: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

@Injectable()
export class MarksRosterService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same class+subject, an internal-category exam, same academic year/semester — the closest real link between a paper's external and internal marks. */
  private async findInternalMapping(classId: number, subjectId: number, academicYear: string, semester: number, excludeMappingId: number) {
    return this.prisma.exam_subject_mapping.findFirst({
      where: {
        class_id: classId,
        subject_id: subjectId,
        id: { not: excludeMappingId },
        exams: { academic_year: academicYear, semester, exam_types: { category: 'internal' } },
      },
      orderBy: { exam_id: 'desc' },
      select: { id: true, exam_id: true },
    });
  }

  /**
   * Batched form of findInternalMapping for N (class_id, subject_id) pairs
   * sharing the same academic_year/semester — one query for every pair
   * instead of one query per pair (the 3 call sites below used to issue one
   * findInternalMapping round trip per class×subject combination, N+1 for
   * a whole department/semester's worth of papers).
   */
  private async findInternalMappingsBatch(
    pairs: { classId: number; subjectId: number; excludeMappingId: number }[],
    academicYear: string,
    semester: number,
  ): Promise<Map<string, { id: number; exam_id: number } | null>> {
    const result = new Map<string, { id: number; exam_id: number } | null>();
    if (pairs.length === 0) return result;

    const classIds = [...new Set(pairs.map((p) => p.classId))];
    const subjectIds = [...new Set(pairs.map((p) => p.subjectId))];

    const candidates = await this.prisma.exam_subject_mapping.findMany({
      where: {
        class_id: { in: classIds },
        subject_id: { in: subjectIds },
        exams: { academic_year: academicYear, semester, exam_types: { category: 'internal' } },
      },
      orderBy: { exam_id: 'desc' },
      select: { id: true, exam_id: true, class_id: true, subject_id: true },
    });

    const byPairKey = new Map<string, { id: number; exam_id: number }[]>();
    for (const c of candidates) {
      const key = `${c.class_id}|${c.subject_id}`;
      const arr = byPairKey.get(key) ?? [];
      arr.push({ id: c.id, exam_id: c.exam_id });
      byPairKey.set(key, arr);
    }

    for (const p of pairs) {
      const key = `${p.classId}|${p.subjectId}`;
      const candidatesForPair = byPairKey.get(key) ?? [];
      result.set(key, candidatesForPair.find((c) => c.id !== p.excludeMappingId) ?? null);
    }
    return result;
  }

  async getRoster(query: MarksRosterQueryDto) {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: query.exam_subject_mapping_id },
      select: {
        id: true,
        exam_id: true,
        class_id: true,
        subject_id: true,
        is_published: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
        classes: {
          select: {
            id: true,
            section: true,
            current_semester: true,
            department_id: true,
            departments: { select: { code: true, name: true } },
            batches: { select: { name: true } },
          },
        },
        exams: {
          select: { id: true, academic_year: true, semester: true, exam_types: { select: { name: true, category: true } } },
        },
      },
    });
    if (!mapping) {
      throw new NotFoundException({ message: 'Exam subject mapping not found.', errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND' });
    }

    const [passRules, students, externalMarks, internalMapping, lock] = await Promise.all([
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.students.findMany({
        where: { class_id: mapping.class_id, status: 'active' },
        select: STUDENT_SELECT,
        orderBy: { register_no: 'asc' },
      }),
      this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: mapping.id } }),
      this.findInternalMapping(mapping.class_id, mapping.subject_id, mapping.exams.academic_year, mapping.exams.semester, mapping.id),
      this.prisma.marks_entry_locks.findUnique({
        where: { exam_id_department_id: { exam_id: mapping.exam_id, department_id: mapping.classes.department_id } },
      }),
    ]);

    const internalMarks = internalMapping
      ? await this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: internalMapping.id } })
      : [];

    const externalByStudent = new Map(externalMarks.map((m) => [m.student_id, m]));
    const internalByStudent = new Map(internalMarks.map((m) => [m.student_id, m]));

    const internalMax = passRules ? Number(passRules.internal_max_marks) : null;
    const externalMax = passRules ? Number(passRules.external_max_marks) : null;
    const passMarkTotal = passRules ? Number(passRules.pass_mark_total) : null;
    const minExternalMarks = passRules ? Number(passRules.min_external_marks) : null;

    const roster = students.map((s) => {
      const external = externalByStudent.get(s.id) ?? null;
      const internal = internalByStudent.get(s.id) ?? null;
      const internalScore = internal?.marks_obtained != null ? Number(internal.marks_obtained) : null;
      const externalScore = external?.marks_obtained != null ? Number(external.marks_obtained) : null;
      const total = internalScore != null && externalScore != null ? internalScore + externalScore : null;
      return {
        student_id: s.id,
        register_no: s.register_no ?? s.student_id_no,
        roll_no: s.roll_no,
        name: studentName(s.soa_applications),
        internal: internal
          ? { id: internal.id, marks_obtained: internalScore, max_marks: Number(internal.max_marks), is_absent: internal.is_absent }
          : null,
        external: external
          ? { id: external.id, marks_obtained: externalScore, max_marks: Number(external.max_marks), is_absent: external.is_absent }
          : null,
        total,
        grade: gradeFor(total),
      };
    });

    return {
      mapping: {
        id: mapping.id,
        exam_id: mapping.exam_id,
        subject_code: mapping.subjects.subject_code,
        subject_name: mapping.subjects.name,
        is_published: mapping.is_published,
        section: mapping.classes.section,
        semester: mapping.classes.current_semester,
        department_code: mapping.classes.departments.code,
        department_name: mapping.classes.departments.name,
        department_id: mapping.classes.department_id,
        batch_name: mapping.classes.batches.name,
        academic_year: mapping.exams.academic_year,
        exam_type_name: mapping.exams.exam_types.name,
      },
      pass_rules:
        internalMax != null && externalMax != null && passMarkTotal != null && minExternalMarks != null
          ? { internal_max_marks: internalMax, external_max_marks: externalMax, pass_mark_total: passMarkTotal, min_external_marks: minExternalMarks }
          : null,
      has_internal_mapping: internalMapping != null,
      is_locked: lock?.is_locked ?? false,
      entries_recorded: externalMarks.filter((m) => m.marks_obtained != null || m.is_absent).length,
      total_students: students.length,
      roster,
    };
  }

  async getGradeMatrix(query: GradeMatrixQueryDto) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: query.exam_id },
      select: { id: true, academic_year: true, semester: true },
    });
    if (!exam) {
      throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: exam.id, classes: { department_id: query.department_id } },
      select: {
        id: true,
        class_id: true,
        subject_id: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
      },
    });
    if (mappings.length === 0) {
      return { department_id: query.department_id, papers: [], students: [] };
    }

    const classIds = [...new Set(mappings.map((m) => m.class_id))];
    const subjectsById = new Map(mappings.map((m) => [m.subject_id, m.subjects]));
    const papers = [...subjectsById.values()].sort((a, b) => a.subject_code.localeCompare(b.subject_code));

    const [students, externalMarks, internalMappingByPair] = await Promise.all([
      this.prisma.students.findMany({
        where: { class_id: { in: classIds }, status: 'active' },
        select: { ...STUDENT_SELECT, classes: { select: { section: true, departments: { select: { code: true } } } } },
        orderBy: { register_no: 'asc' },
      }),
      this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: { in: mappings.map((m) => m.id) } } }),
      this.findInternalMappingsBatch(
        mappings.map((m) => ({ classId: m.class_id, subjectId: m.subject_id, excludeMappingId: m.id })),
        exam.academic_year,
        exam.semester,
      ),
    ]);

    const internalIdByMapping = new Map(
      mappings.map((m) => [m.id, internalMappingByPair.get(`${m.class_id}|${m.subject_id}`)?.id ?? null]),
    );
    const internalMappingIds = [...internalIdByMapping.values()].filter((id): id is number => id != null);
    const internalMarks = internalMappingIds.length
      ? await this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: { in: internalMappingIds } } })
      : [];

    const externalByMappingStudent = new Map(externalMarks.map((m) => [`${m.exam_subject_mapping_id}|${m.student_id}`, m]));
    const internalByMappingStudent = new Map(internalMarks.map((m) => [`${m.exam_subject_mapping_id}|${m.student_id}`, m]));
    const mappingByClassSubject = new Map(mappings.map((m) => [`${m.class_id}|${m.subject_id}`, m]));

    const studentRows = students.map((s) => {
      const grades: Record<number, string | null> = {};
      for (const subjectId of subjectsById.keys()) {
        const mapping = mappingByClassSubject.get(`${s.class_id}|${subjectId}`);
        if (!mapping) {
          grades[subjectId] = null;
          continue;
        }
        const external = externalByMappingStudent.get(`${mapping.id}|${s.id}`);
        const internalId = internalIdByMapping.get(mapping.id);
        const internal = internalId != null ? internalByMappingStudent.get(`${internalId}|${s.id}`) : undefined;
        const externalScore = external?.marks_obtained != null ? Number(external.marks_obtained) : null;
        const internalScore = internal?.marks_obtained != null ? Number(internal.marks_obtained) : null;
        const total = externalScore != null && internalScore != null ? externalScore + internalScore : null;
        grades[subjectId] = external?.is_absent ? 'AB' : gradeFor(total);
      }
      return {
        student_id: s.id,
        register_no: s.register_no ?? s.student_id_no,
        name: studentName(s.soa_applications),
        section: s.classes?.section ?? null,
        department_code: s.classes?.departments.code ?? null,
        grades,
      };
    });

    return {
      department_id: query.department_id,
      papers: papers.map((p) => ({ subject_id: p.id, subject_code: p.subject_code, subject_name: p.name })),
      students: studentRows,
    };
  }

  /**
   * GET /marks-roster/department-completion — real "entries recorded ÷
   * expected" per department for the Dashboard's "Marks entry by
   * department" panel. If `exam_id` isn't given, picks whichever exam
   * actually has the most exam_marks recorded — matching the "busiest real
   * exam" default used everywhere else in COE — falling back to the most
   * recent exam whose timetable has run, then the most recent exam of any
   * status, only when no exam has any marks yet.
   */
  /** Whichever exam actually has the most exam_marks recorded, falling back to the most recent exam whose timetable has run, then the most recent exam of any status — the same "busiest real exam" default used across COE. */
  private async resolveDefaultExamId(): Promise<number | null> {
    const marksByMapping = await this.prisma.exam_marks.groupBy({ by: ['exam_subject_mapping_id'], _count: { _all: true } });
    const mappingIds = marksByMapping.map((m) => m.exam_subject_mapping_id);
    const mappingsWithExam = mappingIds.length
      ? await this.prisma.exam_subject_mapping.findMany({ where: { id: { in: mappingIds } }, select: { id: true, exam_id: true } })
      : [];
    const examIdByMapping = new Map(mappingsWithExam.map((m) => [m.id, m.exam_id]));

    const countByExam = new Map<number, number>();
    for (const row of marksByMapping) {
      const examIdForRow = examIdByMapping.get(row.exam_subject_mapping_id);
      if (examIdForRow == null) continue;
      countByExam.set(examIdForRow, (countByExam.get(examIdForRow) ?? 0) + row._count._all);
    }
    let busiestExamId: number | null = null;
    let busiestCount = 0;
    for (const [id, count] of countByExam) {
      if (count > busiestCount) {
        busiestExamId = id;
        busiestCount = count;
      }
    }
    if (busiestExamId != null) return busiestExamId;

    const exam =
      (await this.prisma.exams.findFirst({ where: { status: { in: ['completed', 'timetable_published'] } }, orderBy: { id: 'desc' }, select: { id: true } })) ??
      (await this.prisma.exams.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }));
    return exam?.id ?? null;
  }

  async getDepartmentCompletion(query: DepartmentCompletionQueryDto) {
    let examId = query.exam_id;
    if (examId === undefined) {
      const resolved = await this.resolveDefaultExamId();
      if (resolved == null) return { exam_id: null, departments: [] };
      examId = resolved;
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId },
      select: {
        id: true,
        class_id: true,
        classes: { select: { department_id: true, departments: { select: { code: true, name: true } } } },
      },
    });
    if (mappings.length === 0) return { exam_id: examId, departments: [] };

    const classIds = [...new Set(mappings.map((m) => m.class_id))];
    const mappingIds = mappings.map((m) => m.id);

    const [studentCounts, recordedCounts] = await Promise.all([
      this.prisma.students.groupBy({ by: ['class_id'], where: { class_id: { in: classIds }, status: 'active' }, _count: { _all: true } }),
      this.prisma.exam_marks.groupBy({
        by: ['exam_subject_mapping_id'],
        where: { exam_subject_mapping_id: { in: mappingIds }, OR: [{ marks_obtained: { not: null } }, { is_absent: true }] },
        _count: { _all: true },
      }),
    ]);

    const studentCountByClass = new Map(studentCounts.map((c) => [c.class_id, c._count._all]));
    const recordedByMapping = new Map(recordedCounts.map((c) => [c.exam_subject_mapping_id, c._count._all]));

    const byDepartment = new Map<number, { code: string; name: string; expected: number; recorded: number }>();
    for (const m of mappings) {
      const dept = m.classes.departments;
      const expected = studentCountByClass.get(m.class_id) ?? 0;
      const recorded = recordedByMapping.get(m.id) ?? 0;
      const existing = byDepartment.get(m.classes.department_id);
      if (existing) {
        existing.expected += expected;
        existing.recorded += recorded;
      } else {
        byDepartment.set(m.classes.department_id, { code: dept.code, name: dept.name, expected, recorded });
      }
    }

    const departments = [...byDepartment.entries()]
      .map(([id, d]) => ({
        department_id: id,
        department_code: d.code,
        department_name: d.name,
        percent: d.expected > 0 ? Math.round((d.recorded / d.expected) * 100) : 0,
        entries_recorded: d.recorded,
        entries_expected: d.expected,
      }))
      .sort((a, b) => b.percent - a.percent);

    return { exam_id: examId, departments };
  }

  /**
   * GET /marks-roster/results-summary — real pass %, arrears, moderation and
   * rank-holder stats for the Results page, computed from real internal+
   * external marks (same join as getRoster/getGradeMatrix) and the real
   * exam_pass_rules_settings threshold. No CGPA anywhere in the schema (no
   * grade-point table), so "average score" is a real average-percentage
   * figure, not a fabricated CGPA — the frontend labels it accordingly.
   */
  async getResultsSummary(query: ResultsSummaryQueryDto) {
    const exam = await this.prisma.exams.findUnique({ where: { id: query.exam_id } });
    if (!exam) {
      throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });
    }

    const [passRules, mappings] = await Promise.all([
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.exam_subject_mapping.findMany({
        where: { exam_id: query.exam_id },
        select: {
          id: true,
          class_id: true,
          subject_id: true,
          classes: { select: { department_id: true, departments: { select: { code: true } } } },
        },
      }),
    ]);
    const passMark = passRules ? Number(passRules.pass_mark_total) : null;

    if (mappings.length === 0) {
      return {
        exam_id: query.exam_id,
        pass_rules_configured: passMark != null,
        candidates_evaluated: 0,
        overall_pass_percentage: null,
        average_percentage: null,
        arrears_count: 0,
        papers_with_arrears: 0,
        papers_moderated: 0,
        candidates_with_grace_marks: 0,
        department_breakdown: [] as { department_code: string; pass_percentage: number; candidates: number }[],
        rank_holders: [] as { student_id: number; register_no: string; name: string | null; department_code: string; score: number }[],
      };
    }

    const mappingIds = mappings.map((m) => m.id);
    const externalMarks = await this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: { in: mappingIds } } });

    const internalMappingByPair = await this.findInternalMappingsBatch(
      mappings.map((m) => ({ classId: m.class_id, subjectId: m.subject_id, excludeMappingId: m.id })),
      exam.academic_year,
      exam.semester,
    );
    const internalMappingByKey = new Map<string, number | null>(
      mappings.map((m) => {
        const key = `${m.class_id}|${m.subject_id}`;
        return [key, internalMappingByPair.get(key)?.id ?? null];
      }),
    );
    const internalMappingIds = [...new Set([...internalMappingByKey.values()].filter((id): id is number => id != null))];
    const internalMarks = internalMappingIds.length
      ? await this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: { in: internalMappingIds } } })
      : [];
    const internalByKey = new Map(internalMarks.map((m) => [`${m.exam_subject_mapping_id}|${m.student_id}`, m]));

    const papersWithArrears = new Set<number>();
    const papersModerated = new Set<number>();
    const candidatesWithGraceMarks = new Set<string>();
    const studentStats = new Map<number, { sum: number; maxSum: number; arrears: number; departmentId: number }>();

    for (const m of mappings) {
      const internalMappingId = internalMappingByKey.get(`${m.class_id}|${m.subject_id}`) ?? null;
      const rowsForMapping = externalMarks.filter((e) => e.exam_subject_mapping_id === m.id);
      for (const ext of rowsForMapping) {
        if (ext.is_moderated) {
          papersModerated.add(m.id);
          candidatesWithGraceMarks.add(`${m.id}|${ext.student_id}`);
        }

        const internal = internalMappingId != null ? internalByKey.get(`${internalMappingId}|${ext.student_id}`) : undefined;
        const externalScore = ext.marks_obtained != null ? Number(ext.marks_obtained) : null;
        const internalScore = internal?.marks_obtained != null ? Number(internal.marks_obtained) : null;
        if (externalScore == null || internalScore == null) continue;

        const total = externalScore + internalScore;
        const maxTotal = Number(ext.max_marks) + Number(internal!.max_marks);

        if (passMark != null && total < passMark) {
          papersWithArrears.add(m.id);
        }

        const existing = studentStats.get(ext.student_id) ?? { sum: 0, maxSum: 0, arrears: 0, departmentId: m.classes.department_id };
        existing.sum += total;
        existing.maxSum += maxTotal;
        if (passMark != null && total < passMark) existing.arrears += 1;
        studentStats.set(ext.student_id, existing);
      }
    }

    const candidatesEvaluated = studentStats.size;
    const passCount = [...studentStats.values()].filter((s) => s.arrears === 0).length;
    const arrearsCount = [...studentStats.values()].reduce((sum, s) => sum + s.arrears, 0);
    const percentages = [...studentStats.entries()].map(([studentId, s]) => ({
      studentId,
      departmentId: s.departmentId,
      percentage: s.maxSum > 0 ? (s.sum / s.maxSum) * 100 : 0,
    }));

    const deptTotals = new Map<number, { code: string; pass: number; total: number }>();
    for (const [studentId, s] of studentStats) {
      const mapping = mappings.find((m) => m.classes.department_id === s.departmentId);
      const code = mapping?.classes.departments.code ?? 'UNK';
      const existing = deptTotals.get(s.departmentId) ?? { code, pass: 0, total: 0 };
      existing.total += 1;
      if (s.arrears === 0) existing.pass += 1;
      deptTotals.set(s.departmentId, existing);
      void studentId;
    }
    const departmentBreakdown = [...deptTotals.values()]
      .map((d) => ({ department_code: d.code, pass_percentage: Math.round((d.pass / d.total) * 100), candidates: d.total }))
      .sort((a, b) => b.pass_percentage - a.pass_percentage);

    const topStudentIds = percentages
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5)
      .map((p) => p.studentId);
    const topStudents = topStudentIds.length
      ? await this.prisma.students.findMany({
          where: { id: { in: topStudentIds } },
          select: {
            id: true,
            register_no: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            classes: { select: { departments: { select: { code: true } } } },
          },
        })
      : [];
    const topStudentById = new Map(topStudents.map((s) => [s.id, s]));
    const rankHolders = topStudentIds
      .map((id) => {
        const student = topStudentById.get(id);
        const stat = percentages.find((p) => p.studentId === id);
        if (!student || !stat) return null;
        return {
          student_id: id,
          register_no: student.register_no ?? student.student_id_no,
          name: studentName(student.soa_applications),
          department_code: student.classes?.departments.code ?? 'UNK',
          score: Math.round((stat.percentage / 10) * 100) / 100,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);

    const averagePercentage = percentages.length ? percentages.reduce((sum, p) => sum + p.percentage, 0) / percentages.length : null;

    return {
      exam_id: query.exam_id,
      pass_rules_configured: passMark != null,
      candidates_evaluated: candidatesEvaluated,
      overall_pass_percentage: candidatesEvaluated > 0 ? Math.round((passCount / candidatesEvaluated) * 1000) / 10 : null,
      average_percentage: averagePercentage != null ? Math.round(averagePercentage * 10) / 10 : null,
      arrears_count: arrearsCount,
      papers_with_arrears: papersWithArrears.size,
      papers_moderated: papersModerated.size,
      candidates_with_grace_marks: new Set([...candidatesWithGraceMarks].map((k) => k.split('|')[1])).size,
      department_breakdown: departmentBreakdown,
      rank_holders: rankHolders,
    };
  }

  /**
   * GET /marks-roster/course-status — one row per (course, mark type) for
   * the COE Marks Management page: Internal (via the same real
   * internal-mapping match as getRoster), External, or Practical (real
   * `subjects.course_type = PRACTICAL`, not a fabricated third mark type)
   * — with real entered/verified counts, real entered-by/verified-by
   * (resolved to a name only when every entered mark shares one faculty;
   * "COE cell" when several different people entered/verified marks for
   * it, which is exactly what real bundle-based external valuation looks
   * like), and the real per-(exam,department) lock.
   */
  async getCourseMarkStatus(query: CourseMarkStatusQueryDto) {
    let examId = query.exam_id;
    if (examId === undefined) {
      const resolved = await this.resolveDefaultExamId();
      if (resolved == null) return { exam_id: null, rows: [] };
      examId = resolved;
    }

    const exam = await this.prisma.exams.findUnique({ where: { id: examId }, select: { academic_year: true, semester: true } });
    if (!exam) return { exam_id: examId, rows: [] };

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId },
      select: {
        id: true,
        exam_id: true,
        class_id: true,
        subject_id: true,
        subjects: { select: { id: true, name: true, subject_code: true, course_type: true } },
        classes: { select: { current_semester: true, department_id: true, departments: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (mappings.length === 0) return { exam_id: examId, rows: [] };

    const internalMappingByPair = await this.findInternalMappingsBatch(
      mappings.map((m) => ({ classId: m.class_id, subjectId: m.subject_id, excludeMappingId: m.id })),
      exam.academic_year,
      exam.semester,
    );
    const internalByMainId = new Map<number, { id: number; exam_id: number } | null>(
      mappings.map((m) => [m.id, internalMappingByPair.get(`${m.class_id}|${m.subject_id}`) ?? null]),
    );

    const internalMappings = [...internalByMainId.values()].filter((im): im is { id: number; exam_id: number } => im != null);
    const allMappingIds = [...mappings.map((m) => m.id), ...internalMappings.map((im) => im.id)];

    const [allMarks, classStudentCounts, locks] = await Promise.all([
      this.prisma.exam_marks.findMany({
        where: { exam_subject_mapping_id: { in: allMappingIds } },
        select: { exam_subject_mapping_id: true, marks_obtained: true, is_absent: true, entered_by_faculty_id: true, verified_by_faculty_id: true },
      }),
      this.prisma.students.groupBy({ by: ['class_id'], where: { class_id: { in: mappings.map((m) => m.class_id) }, status: 'active' }, _count: { _all: true } }),
      this.prisma.marks_entry_locks.findMany({ where: { department_id: { in: mappings.map((m) => m.classes.department_id) } } }),
    ]);

    const marksByMapping = new Map<number, typeof allMarks>();
    for (const mk of allMarks) {
      const list = marksByMapping.get(mk.exam_subject_mapping_id) ?? [];
      list.push(mk);
      marksByMapping.set(mk.exam_subject_mapping_id, list);
    }
    const studentCountByClass = new Map(classStudentCounts.map((c) => [c.class_id, c._count._all]));
    const lockByKey = new Map(locks.map((l) => [`${l.exam_id}|${l.department_id}`, l.is_locked]));

    const facultyIds = [...new Set(allMarks.flatMap((m) => [m.entered_by_faculty_id, m.verified_by_faculty_id]).filter((id): id is number => id != null))];
    const facultyRows = facultyIds.length
      ? await this.prisma.faculty.findMany({ where: { id: { in: facultyIds } }, select: { id: true, prefix: true, first_name: true, last_name: true } })
      : [];
    const facultyById = new Map(facultyRows.map((f) => [f.id, facultyDisplayName(f)]));

    const resolveWho = (ids: Set<number>): string | null => {
      if (ids.size === 0) return null;
      if (ids.size === 1) return facultyById.get([...ids][0]) ?? null;
      return 'COE cell';
    };

    const buildRow = (mappingId: number, examIdForRow: number, departmentId: number, totalStudents: number, markType: CourseMarkType, mainMappingId: number) => {
      const marks = marksByMapping.get(mappingId) ?? [];
      const entered = marks.filter((m) => m.marks_obtained != null || m.is_absent);
      const enteredByIds = new Set(entered.map((m) => m.entered_by_faculty_id).filter((id): id is number => id != null));
      const verifiedByIds = new Set(entered.map((m) => m.verified_by_faculty_id).filter((id): id is number => id != null));
      const allVerified = entered.length > 0 && entered.every((m) => m.verified_by_faculty_id != null);
      const isLocked = lockByKey.get(`${examIdForRow}|${departmentId}`) ?? false;

      let status: CourseMarkRowStatus;
      if (isLocked) status = 'locked';
      else if (entered.length === 0) status = 'not_started';
      else if (entered.length < totalStudents) status = 'in_progress';
      else status = allVerified ? 'verified' : 'submitted';

      return {
        exam_subject_mapping_id: mappingId,
        // The "external" mapping id — always the one getRoster()/getGradeMatrix() expect,
        // since that's the anchor they resolve the internal counterpart *from*. An internal
        // row's own exam_subject_mapping_id is the internal mapping, so it needs this
        // separately to fetch the same combined internal+external roster the main row sees.
        main_exam_subject_mapping_id: mainMappingId,
        exam_id: examIdForRow,
        mark_type: markType,
        entered_count: entered.length,
        total_students: totalStudents,
        entered_by: resolveWho(enteredByIds),
        verified_by: resolveWho(verifiedByIds),
        is_locked: isLocked,
        status,
      };
    };

    const rows: Array<ReturnType<typeof buildRow> & { subject: unknown; department: unknown; semester: number | null }> = [];
    for (const m of mappings) {
      const totalStudents = studentCountByClass.get(m.class_id) ?? 0;
      const internal = internalByMainId.get(m.id) ?? null;
      if (internal) {
        rows.push({
          ...buildRow(internal.id, internal.exam_id, m.classes.department_id, totalStudents, 'internal', m.id),
          subject: m.subjects,
          department: m.classes.departments,
          semester: m.classes.current_semester,
        });
      }
      const mainType: CourseMarkType = m.subjects.course_type === 'PRACTICAL' ? 'practical' : 'external';
      rows.push({
        ...buildRow(m.id, m.exam_id, m.classes.department_id, totalStudents, mainType, m.id),
        subject: m.subjects,
        department: m.classes.departments,
        semester: m.classes.current_semester,
      });
    }

    return { exam_id: examId, rows };
  }

  /** POST /marks-roster/verify — bulk-marks every currently-entered exam_marks row for one course as verified. Real verified_at/verified_by_faculty_id columns, previously write-only from nowhere in the UI. */
  async verifyMapping(dto: VerifyMappingMarksDto) {
    const marks = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: dto.exam_subject_mapping_id, OR: [{ marks_obtained: { not: null } }, { is_absent: true }] },
      select: { id: true },
    });
    if (marks.length === 0) {
      throw new UnprocessableEntityException({ message: 'No entered marks to verify for this course yet.', errorCode: 'NO_MARKS_ENTERED' });
    }

    await this.prisma.exam_marks.updateMany({
      where: { id: { in: marks.map((m) => m.id) } },
      data: { verified_at: new Date(), verified_by_faculty_id: dto.verified_by_faculty_id },
    });

    return { exam_subject_mapping_id: dto.exam_subject_mapping_id, verified_count: marks.length };
  }
}
