import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListCourseResultsQueryDto } from './dto/list-course-results-query.dto';

const MAPPING_INCLUDE = {
  subjects: { select: { id: true, name: true, subject_code: true } },
  classes: { select: { current_semester: true, department_id: true, departments: { select: { id: true, code: true, name: true } } } },
} as const;

@Injectable()
export class CourseResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same class+subject, an internal-category exam, same academic year/semester — the closest real link between a paper's external and internal marks (mirrors marks-roster.service.ts). */
  private async findInternalMapping(classId: number, subjectId: number, academicYear: string, semester: number, excludeMappingId: number) {
    return this.prisma.exam_subject_mapping.findFirst({
      where: {
        class_id: classId,
        subject_id: subjectId,
        id: { not: excludeMappingId },
        exams: { academic_year: academicYear, semester, exam_types: { category: 'internal' } },
      },
      orderBy: { exam_id: 'desc' },
      select: { id: true },
    });
  }

  /** Combined internal+external total per student for one mapping — pass_mark_total is always a threshold on the combined total, never on the external component alone. */
  private async totalsForMapping(mapping: { id: number; class_id: number; subject_id: number }, exam: { academic_year: string; semester: number }) {
    const externalMarks = await this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: mapping.id } });
    const internalMapping = await this.findInternalMapping(mapping.class_id, mapping.subject_id, exam.academic_year, exam.semester, mapping.id);
    const internalMarks = internalMapping ? await this.prisma.exam_marks.findMany({ where: { exam_subject_mapping_id: internalMapping.id } }) : [];
    const internalByStudent = new Map(internalMarks.map((x) => [x.student_id, x]));

    return externalMarks.map((x) => {
      const externalScore = x.marks_obtained != null ? Number(x.marks_obtained) : null;
      const internalScore = internalByStudent.get(x.student_id)?.marks_obtained != null ? Number(internalByStudent.get(x.student_id)!.marks_obtained) : null;
      const total = externalScore != null && internalScore != null ? externalScore + internalScore : externalScore;
      return { is_absent: x.is_absent, total };
    });
  }

  private async rowsForExam(examId: number) {
    const [exam, mappings, rules, gradeBands] = await Promise.all([
      this.prisma.exams.findUnique({ where: { id: examId } }),
      this.prisma.exam_subject_mapping.findMany({ where: { exam_id: examId }, include: MAPPING_INCLUDE, distinct: ['subject_id'] }),
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.grade_bands.findMany({ orderBy: { min_percentage: 'desc' } }),
    ]);
    if (!exam) return [];

    const passMark = rules ? Number(rules.pass_mark_total) : 50;
    const maxMarks = rules ? Number(rules.internal_max_marks) + Number(rules.external_max_marks) : 100;

    const realStatuses = await this.prisma.course_result_status.findMany({ where: { exam_subject_mapping_id: { in: mappings.map((m) => m.id) } } });
    const statusByMapping = new Map(realStatuses.map((s) => [s.exam_subject_mapping_id, s]));

    const rows: {
      exam_subject_mapping_id: number;
      subject: { id: number; name: string; subject_code: string };
      department: { id: number; code: string; name: string } | null;
      department_id: number | null;
      semester: number | null;
      appeared: number;
      passed: number;
      pass_pct: number;
      highest_gpa: number | null;
      status: string;
      withheld_reason: string | null;
    }[] = [];
    for (const m of mappings) {
      const totals = await this.totalsForMapping(m, exam);
      const appeared = totals.filter((x) => !x.is_absent).length;
      const passed = totals.filter((x) => !x.is_absent && Number(x.total ?? 0) >= passMark).length;
      const passPct = appeared > 0 ? Math.round(((passed / appeared) * 100 + Number.EPSILON) * 10) / 10 : 0;

      let highestGpa: number | null = null;
      const top = totals.filter((x) => !x.is_absent).sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0))[0];
      if (top) {
        const pct = (Number(top.total ?? 0) / maxMarks) * 100;
        const band = gradeBands.find((b) => pct >= Number(b.min_percentage));
        highestGpa = band?.grade_point != null ? Number(band.grade_point) : null;
      }

      const status = statusByMapping.get(m.id);
      rows.push({
        exam_subject_mapping_id: m.id,
        subject: m.subjects,
        department: m.classes?.departments ?? null,
        department_id: m.classes?.department_id ?? null,
        semester: m.classes?.current_semester ?? null,
        appeared,
        passed,
        pass_pct: passPct,
        highest_gpa: highestGpa,
        // A course only becomes "computed" once the COE actually runs
        // Compute (creating the real course_result_status row) — appeared
        // marks alone don't mean it's computed, otherwise Approve/Publish
        // 404 against a status row that was never really created.
        status: status?.status ?? 'awaiting_pass_board',
        withheld_reason: status?.withheld_reason ?? null,
      });
    }
    return rows;
  }

  async findAll(query: ListCourseResultsQueryDto) {
    let rows = await this.rowsForExam(query.exam_id);
    if (query.department_id) rows = rows.filter((r) => r.department_id === query.department_id);
    if (query.semester) rows = rows.filter((r) => r.semester === query.semester);
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter((r) => r.subject.name.toLowerCase().includes(q) || r.subject.subject_code.toLowerCase().includes(q));
    }
    return rows;
  }

  async getStats(examId: number) {
    const rows = await this.rowsForExam(examId);
    const totalAppeared = rows.reduce((s, r) => s + r.appeared, 0);
    const totalPassed = rows.reduce((s, r) => s + r.passed, 0);
    const overallPassPct = totalAppeared > 0 ? Math.round(((totalPassed / totalAppeared) * 100 + Number.EPSILON) * 10) / 10 : 0;

    // "vs last cycle" — the most recent OTHER exam of the same exam_type,
    // compared the same way. Null (not fabricated) when there's no real
    // prior cycle to compare against.
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    let passPctDelta: number | null = null;
    if (exam) {
      const priorExam = await this.prisma.exams.findFirst({
        where: { exam_type_id: exam.exam_type_id, id: { lt: examId } },
        orderBy: { id: 'desc' },
      });
      if (priorExam) {
        const priorRows = await this.rowsForExam(priorExam.id);
        const priorAppeared = priorRows.reduce((s, r) => s + r.appeared, 0);
        const priorPassed = priorRows.reduce((s, r) => s + r.passed, 0);
        if (priorAppeared > 0) {
          const priorPct = (priorPassed / priorAppeared) * 100;
          passPctDelta = Math.round((overallPassPct - priorPct) * 10) / 10;
        }
      }
    }

    const boardSheet = await this.prisma.pass_board_sheets.findFirst({
      where: { exam_id: examId, meeting_at: { not: null } },
      orderBy: { meeting_at: 'asc' },
    });

    const withheld = rows.filter((r) => r.withheld_reason);
    const withheldMalpractice = withheld.filter((r) => r.withheld_reason!.toLowerCase().includes('malpractice')).length;
    const withheldOther = withheld.length - withheldMalpractice;

    return {
      total_courses: rows.length,
      published_count: rows.filter((r) => r.status === 'published').length,
      overall_pass_pct: overallPassPct,
      pass_pct_delta: passPctDelta,
      awaiting_approval_count: rows.filter((r) => r.status === 'computed' || r.status === 'awaiting_pass_board').length,
      board_meeting_at: boardSheet?.meeting_at ?? null,
      withheld_count: withheld.length,
      withheld_malpractice_count: withheldMalpractice,
      withheld_other_count: withheldOther,
    };
  }

  /** Real grade distribution for one course — backs the "Analysis" action shown once a course is published. */
  async getAnalysis(examSubjectMappingId: number) {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({ where: { id: examSubjectMappingId }, include: MAPPING_INCLUDE });
    if (!mapping) throw new NotFoundException({ message: 'Mapping not found.', errorCode: 'MAPPING_NOT_FOUND' });

    const [exam, rules, gradeBands] = await Promise.all([
      this.prisma.exams.findUnique({ where: { id: mapping.exam_id } }),
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } }),
    ]);
    if (!exam) throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });

    const totals = await this.totalsForMapping(mapping, exam);
    const maxMarks = rules ? Number(rules.internal_max_marks) + Number(rules.external_max_marks) : 100;
    const passMark = rules ? Number(rules.pass_mark_total) : 50;
    const scored = totals.filter((m) => !m.is_absent && m.total != null);
    const absentCount = totals.filter((m) => m.is_absent).length;
    const gradeBandsDesc = [...gradeBands].sort((a, b) => Number(b.min_percentage) - Number(a.min_percentage));

    const distribution = gradeBands.map((b) => ({
      grade: b.grade_label,
      count: scored.filter((m) => {
        const pct = (Number(m.total) / maxMarks) * 100;
        const band = gradeBandsDesc.find((gb) => pct >= Number(gb.min_percentage));
        return band?.grade_label === b.grade_label;
      }).length,
    }));

    const total = scored.length;
    const passed = scored.filter((m) => Number(m.total) >= passMark).length;
    const average = total > 0 ? Math.round((scored.reduce((s, m) => s + Number(m.total), 0) / total) * 10) / 10 : 0;
    const highest = total > 0 ? Math.max(...scored.map((m) => Number(m.total))) : null;
    const lowest = total > 0 ? Math.min(...scored.map((m) => Number(m.total))) : null;

    return {
      subject: mapping.subjects,
      department: mapping.classes?.departments ?? null,
      total_appeared: total,
      absent: absentCount,
      passed,
      failed: total - passed,
      average_marks: average,
      highest_marks: highest,
      lowest_marks: lowest,
      max_marks: maxMarks,
      grade_distribution: distribution,
    };
  }

  async compute(examSubjectMappingId: number) {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({ where: { id: examSubjectMappingId } });
    if (!mapping) throw new NotFoundException({ message: 'Mapping not found.', errorCode: 'MAPPING_NOT_FOUND' });

    return this.prisma.course_result_status.upsert({
      where: { exam_subject_mapping_id: examSubjectMappingId },
      create: { exam_subject_mapping_id: examSubjectMappingId, status: 'computed', computed_at: new Date() },
      update: { status: 'computed', computed_at: new Date() },
    });
  }

  async approve(examSubjectMappingId: number, userId: number) {
    const existing = await this.prisma.course_result_status.findUnique({ where: { exam_subject_mapping_id: examSubjectMappingId } });
    if (!existing) throw new NotFoundException({ message: 'Course result not computed yet.', errorCode: 'NOT_COMPUTED' });

    return this.prisma.course_result_status.update({
      where: { exam_subject_mapping_id: examSubjectMappingId },
      data: { status: 'approved', approved_by_user_id: userId, approved_at: new Date() },
    });
  }

  async publish(examSubjectMappingId: number) {
    const existing = await this.prisma.course_result_status.findUnique({ where: { exam_subject_mapping_id: examSubjectMappingId } });
    if (!existing || existing.status !== 'approved') {
      throw new NotFoundException({ message: 'Course must be approved before publishing.', errorCode: 'NOT_APPROVED' });
    }

    return this.prisma.course_result_status.update({ where: { exam_subject_mapping_id: examSubjectMappingId }, data: { status: 'published' } });
  }
}
