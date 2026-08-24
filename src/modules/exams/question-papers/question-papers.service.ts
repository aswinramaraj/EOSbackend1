import { Injectable, NotFoundException } from '@nestjs/common';
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

  private async rowsForExam(examId: number, departmentId?: number, search?: string) {
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        exam_id: examId,
        ...(departmentId ? { classes: { department_id: departmentId } } : {}),
        ...(search
          ? { subjects: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { subject_code: { contains: search, mode: 'insensitive' } }] } }
          : {}),
      },
      include: MAPPING_INCLUDE,
      distinct: ['subject_id'],
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
        subject: m.subjects,
        department: m.classes?.departments ?? null,
        semester: m.classes?.current_semester ?? null,
        question_paper_id: paper?.id ?? null,
        setter: paper?.faculty_question_papers_setter_faculty_idTofaculty ?? null,
        moderator: paper?.faculty_question_papers_moderator_faculty_idTofaculty ?? null,
        sets_count: paper?.sets_count ?? 0,
        vaulted: paper?.vaulted ?? false,
        status: paper?.status ?? 'awaiting_upload',
      };
    });
  }

  async findAll(query: ListQuestionPapersQueryDto) {
    if (!query.exam_id) return [];
    const rows = await this.rowsForExam(query.exam_id, query.department_id, query.search);
    return query.status ? rows.filter((r) => r.status === query.status) : rows;
  }

  async getStats(examId: number) {
    const rows = await this.rowsForExam(examId);
    return {
      required: rows.length,
      sealed: rows.filter((r) => r.status === 'sealed').length,
      awaiting_upload: rows.filter((r) => r.status === 'awaiting_upload').length,
      under_moderation: rows.filter((r) => r.status === 'under_moderation').length,
    };
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
      },
      update: {
        setter_faculty_id: dto.setter_faculty_id,
        moderator_faculty_id: dto.moderator_faculty_id,
        sets_count: dto.sets_count,
        status: dto.status,
        vaulted: dto.status === 'sealed' ? true : undefined,
        updated_at: new Date(),
      },
    });
  }
}
