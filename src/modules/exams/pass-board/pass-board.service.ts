import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SetGraceDto, GRACE_MARKS_CEILING } from './dto/set-grace.dto';
import { AddSignoffDto } from './dto/add-signoff.dto';

const MAPPING_INCLUDE = {
  subjects: { select: { id: true, name: true, subject_code: true } },
  classes: { select: { departments: { select: { id: true, code: true, name: true } } } },
} as const;

@Injectable()
export class PassBoardService {
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

  async getOrCreateSheet(examId: number, phase = 'Phase 1') {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });

    let sheet = await this.prisma.pass_board_sheets.findUnique({ where: { exam_id_phase: { exam_id: examId, phase } } });
    if (!sheet) {
      sheet = await this.prisma.pass_board_sheets.create({ data: { exam_id: examId, phase } });
    }
    return sheet;
  }

  async getSheetDetail(examId: number, phase = 'Phase 1') {
    const sheet = await this.getOrCreateSheet(examId, phase);

    const [exam, mappings, graceRows, signoffs, rules] = await Promise.all([
      this.prisma.exams.findUnique({ where: { id: examId }, include: { exam_types: { select: { name: true } } } }),
      this.prisma.exam_subject_mapping.findMany({ where: { exam_id: examId }, include: MAPPING_INCLUDE, distinct: ['subject_id'] }),
      this.prisma.pass_board_course_grace.findMany({ where: { sheet_id: sheet.id } }),
      this.prisma.pass_board_signoffs.findMany({ where: { sheet_id: sheet.id } }),
      this.prisma.exam_pass_rules_settings.findFirst(),
    ]);
    const graceByMapping = new Map(graceRows.map((g) => [g.exam_subject_mapping_id, g]));
    const passMark = rules ? Number(rules.pass_mark_total) : 50;
    const departmentCodes = new Set<string>();

    const courses: {
      exam_subject_mapping_id: number;
      subject: { id: number; name: string; subject_code: string };
      department: { id: number; code: string; name: string } | null;
      appeared: number;
      pass_pct_before: number;
      pass_pct_after: number;
      moved: number;
      grace_marks: number;
      board_note: string | null;
    }[] = [];
    for (const m of mappings) {
      if (m.classes?.departments) departmentCodes.add(m.classes.departments.code);
      const totals = exam ? await this.totalsForMapping(m, exam) : [];
      const appeared = totals.filter((x) => !x.is_absent).length;
      const grace = graceByMapping.get(m.id);
      const graceMarks = grace ? Number(grace.grace_marks) : 0;

      const passedBefore = totals.filter((x) => !x.is_absent && Number(x.total ?? 0) >= passMark).length;
      const passedAfter = totals.filter((x) => !x.is_absent && Number(x.total ?? 0) + graceMarks >= passMark).length;
      const pctBefore = appeared > 0 ? Math.round(((passedBefore / appeared) * 100 + Number.EPSILON) * 10) / 10 : 0;
      const pctAfter = appeared > 0 ? Math.round(((passedAfter / appeared) * 100 + Number.EPSILON) * 10) / 10 : 0;

      courses.push({
        exam_subject_mapping_id: m.id,
        subject: m.subjects,
        department: m.classes?.departments ?? null,
        appeared,
        pass_pct_before: pctBefore,
        pass_pct_after: pctAfter,
        moved: passedAfter - passedBefore,
        grace_marks: graceMarks,
        board_note: grace?.board_note ?? null,
      });
    }

    const overallAppeared = courses.reduce((s, c) => s + c.appeared, 0);
    const overallPassPctBefore = overallAppeared
      ? Math.round(((courses.reduce((s, c) => s + (c.pass_pct_before * c.appeared) / 100, 0) / overallAppeared) * 100 + Number.EPSILON) * 10) / 10
      : 0;

    return {
      sheet,
      exam_type_name: exam?.exam_types.name ?? null,
      exam_title: exam?.title ?? null,
      grace_ceiling: GRACE_MARKS_CEILING,
      courses,
      signoffs,
      overall_appeared: overallAppeared,
      overall_pass_pct_before: overallPassPctBefore,
      departments_represented: [...departmentCodes].sort(),
      courses_graced_count: courses.filter((c) => c.grace_marks !== 0).length,
    };
  }

  async setGrace(examId: number, dto: SetGraceDto, phase = 'Phase 1') {
    const sheet = await this.getOrCreateSheet(examId, phase);
    if (sheet.status === 'frozen') throw new BadRequestException({ message: 'This sheet is already frozen.', errorCode: 'SHEET_FROZEN' });

    return this.prisma.pass_board_course_grace.upsert({
      where: { sheet_id_exam_subject_mapping_id: { sheet_id: sheet.id, exam_subject_mapping_id: dto.exam_subject_mapping_id } },
      create: { sheet_id: sheet.id, exam_subject_mapping_id: dto.exam_subject_mapping_id, grace_marks: dto.grace_marks, board_note: dto.board_note },
      update: { grace_marks: dto.grace_marks, board_note: dto.board_note },
    });
  }

  /** Real bulk reset — clears every course's grace marks/board note on this sheet, back to the raw (ungraced) picture. */
  async resetModeration(examId: number, phase = 'Phase 1') {
    const sheet = await this.getOrCreateSheet(examId, phase);
    if (sheet.status === 'frozen') throw new BadRequestException({ message: 'This sheet is already frozen.', errorCode: 'SHEET_FROZEN' });

    await this.prisma.pass_board_course_grace.deleteMany({ where: { sheet_id: sheet.id } });
    return { reset: true };
  }

  async addSignoff(examId: number, dto: AddSignoffDto, phase = 'Phase 1') {
    const sheet = await this.getOrCreateSheet(examId, phase);
    return this.prisma.pass_board_signoffs.create({ data: { sheet_id: sheet.id, member_name: dto.member_name, member_role: dto.member_role } });
  }

  async sign(signoffId: number) {
    const existing = await this.prisma.pass_board_signoffs.findUnique({ where: { id: signoffId } });
    if (!existing) throw new NotFoundException({ message: 'Signoff not found.', errorCode: 'SIGNOFF_NOT_FOUND' });

    return this.prisma.pass_board_signoffs.update({ where: { id: signoffId }, data: { status: 'signed', signed_at: new Date() } });
  }

  async freeze(examId: number, phase = 'Phase 1') {
    const sheet = await this.getOrCreateSheet(examId, phase);
    const pendingSignoffs = await this.prisma.pass_board_signoffs.count({ where: { sheet_id: sheet.id, status: 'awaiting' } });
    if (pendingSignoffs > 0) {
      throw new BadRequestException({ message: `${pendingSignoffs} member(s) have not signed yet.`, errorCode: 'SIGNOFFS_PENDING' });
    }

    return this.prisma.pass_board_sheets.update({ where: { id: sheet.id }, data: { status: 'frozen' } });
  }
}
