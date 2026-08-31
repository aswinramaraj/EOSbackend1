import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListQuestionPapersQueryDto } from './dto/list-question-papers-query.dto';
import { UpsertQuestionPaperDto } from './dto/upsert-question-paper.dto';

const FACULTY_SELECT = { id: true, first_name: true, last_name: true } as const;

const MAPPING_INCLUDE = {
  subjects: { select: { id: true, name: true, subject_code: true } },
  classes: { select: { current_semester: true, department_id: true, departments: { select: { id: true, code: true, name: true } } } },
} as const;

@Injectable()
export class QuestionPapersService {
  constructor(private readonly prisma: PrismaService) {}

  /** examId omitted = every exam ("All exams" in the filter). Distinct is keyed on [exam_id, subject_id] in that case so the same subject offered under two different exams (e.g. regular + arrear) still surfaces as two rows, not one collapsed row. */
  private async rowsFor(examId?: number, departmentId?: number, search?: string) {
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        ...(examId ? { exam_id: examId } : {}),
        ...(departmentId ? { classes: { department_id: departmentId } } : {}),
        ...(search
          ? { subjects: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { subject_code: { contains: search, mode: 'insensitive' } }] } }
          : {}),
      },
      include: MAPPING_INCLUDE,
      distinct: examId ? ['subject_id'] : ['exam_id', 'subject_id'],
    });

    const papers = await this.prisma.question_papers.findMany({
      where: { exam_subject_mapping_id: { in: mappings.map((m) => m.id) } },
      include: { faculty_question_papers_setter_faculty_idTofaculty: { select: FACULTY_SELECT }, faculty_question_papers_moderator_faculty_idTofaculty: { select: FACULTY_SELECT } },
    });
    const paperByMapping = new Map(papers.map((p) => [p.exam_subject_mapping_id, p]));

    return mappings.map((m) => {
      const paper = paperByMapping.get(m.id);
      return {
        exam_subject_mapping_id: m.id,
        exam_id: m.exam_id,
        subject: m.subjects,
        department: m.classes?.departments ?? null,
        semester: m.classes?.current_semester ?? null,
        question_paper_id: paper?.id ?? null,
        setter: paper?.faculty_question_papers_setter_faculty_idTofaculty ?? null,
        moderator: paper?.faculty_question_papers_moderator_faculty_idTofaculty ?? null,
        sets_count: paper?.sets_count ?? 0,
        vaulted: paper?.vaulted ?? false,
        status: paper?.status ?? 'awaiting_upload',
        due_date: paper?.due_date ? paper.due_date.toISOString().slice(0, 10) : null,
      };
    });
  }

  async findAll(query: ListQuestionPapersQueryDto) {
    const rows = await this.rowsFor(query.exam_id, query.department_id, query.search);
    return query.status ? rows.filter((r) => r.status === query.status) : rows;
  }

  async getStats(examId?: number) {
    const rows = await this.rowsFor(examId);
    const awaitingRows = rows.filter((r) => r.status === 'awaiting_upload');
    const todayStr = new Date().toISOString().slice(0, 10);
    const distribution = await this.getDistributionReadiness(examId);
    return {
      required: rows.length,
      sealed: rows.filter((r) => r.status === 'sealed').length,
      awaiting_upload: awaitingRows.length,
      awaiting_without_setter: awaitingRows.filter((r) => !r.setter).length,
      // Real now that question_papers.due_date exists — a setter is "flagged"
      // once their recorded due date has passed and the paper still isn't uploaded.
      awaiting_flagged: awaitingRows.filter((r) => r.due_date != null && r.due_date < todayStr).length,
      under_moderation: rows.filter((r) => r.status === 'under_moderation').length,
      distribution_ready: distribution.ready,
      distribution_total: distribution.total,
    };
  }

  /**
   * How many real exam sessions (date + session, from exam_timetable) have
   * every paper they need already sealed — "ready" meaning every subject
   * scheduled in that session has a sealed question_papers row.
   */
  private async getDistributionReadiness(examId?: number): Promise<{ ready: number; total: number }> {
    const timetableRows = await this.prisma.exam_timetable.findMany({
      where: { exam_subject_mapping: examId ? { exam_id: examId } : undefined },
      select: { exam_date: true, session: true, exam_subject_mapping_id: true },
    });
    if (timetableRows.length === 0) return { ready: 0, total: 0 };

    const mappingIds = [...new Set(timetableRows.map((r) => r.exam_subject_mapping_id))];
    const papers = await this.prisma.question_papers.findMany({
      where: { exam_subject_mapping_id: { in: mappingIds } },
      select: { exam_subject_mapping_id: true, status: true },
    });
    const sealedByMapping = new Set(papers.filter((p) => p.status === 'sealed').map((p) => p.exam_subject_mapping_id));

    const sessionMappings = new Map<string, Set<number>>();
    for (const row of timetableRows) {
      const key = `${row.exam_date.toISOString().slice(0, 10)}|${row.session}`;
      const set = sessionMappings.get(key) ?? new Set<number>();
      set.add(row.exam_subject_mapping_id);
      sessionMappings.set(key, set);
    }

    let ready = 0;
    for (const ids of sessionMappings.values()) {
      if ([...ids].every((id) => sealedByMapping.has(id))) ready++;
    }
    return { ready, total: sessionMappings.size };
  }

  /** POST /question-papers/:examSubjectMappingId/remind — a real in-app notification to the assigned setter's own user account, same dispatch pattern as invigilation's remind(). Nothing to remind if no setter has been assigned yet. */
  async remind(examSubjectMappingId: number) {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({ where: { id: examSubjectMappingId }, include: { subjects: { select: { name: true, subject_code: true } } } });
    if (!mapping) throw new NotFoundException({ message: 'Exam subject mapping not found.', errorCode: 'MAPPING_NOT_FOUND' });

    const paper = await this.prisma.question_papers.findUnique({
      where: { exam_subject_mapping_id: examSubjectMappingId },
      include: { faculty_question_papers_setter_faculty_idTofaculty: { select: { user_id: true } } },
    });
    const setterUserId = paper?.faculty_question_papers_setter_faculty_idTofaculty?.user_id;
    if (!setterUserId) {
      throw new UnprocessableEntityException({ message: 'No setter has been assigned to this course yet — request a paper first.', errorCode: 'NO_SETTER_ASSIGNED' });
    }

    return this.prisma.notifications.create({
      data: {
        user_id: setterUserId,
        title: 'Question paper upload reminder',
        message: `Reminder: the question paper for ${mapping.subjects.subject_code} · ${mapping.subjects.name} is still awaiting upload. Please submit it soon.`,
        related_entity_type: 'question_papers',
        related_entity_id: paper!.id,
      },
    });
  }

  /** GET /question-papers/count — real question_papers rows recorded across every exam. Used only for the sidebar nav badge. */
  async countAll() {
    return this.prisma.question_papers.count();
  }

  async upsert(dto: UpsertQuestionPaperDto) {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({ where: { id: dto.exam_subject_mapping_id } });
    if (!mapping) throw new NotFoundException({ message: 'Exam subject mapping not found.', errorCode: 'MAPPING_NOT_FOUND' });

    return this.prisma.question_papers.upsert({
      where: { exam_subject_mapping_id: dto.exam_subject_mapping_id },
      create: {
        exam_subject_mapping_id: dto.exam_subject_mapping_id,
        setter_faculty_id: dto.setter_faculty_id,
        moderator_faculty_id: dto.moderator_faculty_id,
        sets_count: dto.sets_count ?? 0,
        status: dto.status ?? 'awaiting_upload',
        vaulted: dto.status === 'sealed',
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
      },
      update: {
        setter_faculty_id: dto.setter_faculty_id,
        moderator_faculty_id: dto.moderator_faculty_id,
        sets_count: dto.sets_count,
        status: dto.status,
        vaulted: dto.status === 'sealed' ? true : undefined,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        updated_at: new Date(),
      },
    });
  }
}
