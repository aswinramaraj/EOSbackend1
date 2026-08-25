// revaluation.service.ts
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRevaluationDto } from './dto/create-revaluation.dto';
import { UpdateRevaluationDto } from './dto/update-revaluation.dto';

const VALID_STATUSES = ['requested', 'under_review', 'revised', 'no_change', 'approved', 'rejected'];

const STUDENT_INCLUDE = { soa_applications: { select: { first_name: true, last_name: true } } } as const;
const FACULTY_SELECT = { id: true, first_name: true, last_name: true } as const;

@Injectable()
export class RevaluationService {
  private readonly logger = new Logger(RevaluationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createRevaluationDto: CreateRevaluationDto) {
    const { exam_marks_id, student_id } = createRevaluationDto;

    const examMark = await this.prisma.exam_marks.findUnique({
      where: { id: exam_marks_id },
    });

    if (!examMark) {
      throw new NotFoundException({
        message: 'Exam marks record not found.',
        errorCode: 'EXAM_MARKS_NOT_FOUND',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id: student_id },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const existing = await this.prisma.revaluation_requests.findFirst({
      where: { exam_marks_id, student_id },
    });

    if (existing) {
      throw new ConflictException({
        message: 'A revaluation request already exists for this exam mark.',
        errorCode: 'REVALUATION_REQUEST_EXISTS',
      });
    }

    try {
      return await this.prisma.revaluation_requests.create({
        data: { exam_marks_id, student_id },
      });
    } catch (err: any) {
      this.logger.error('DB error while creating revaluation request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(status?: string) {
    if (status && !VALID_STATUSES.includes(status)) {
      throw new BadRequestException({
        message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
        errorCode: 'INVALID_STATUS_FILTER',
      });
    }

    try {
      return await this.prisma.revaluation_requests.findMany({
        where: status ? { status: status as any } : undefined,
        orderBy: { requested_at: 'desc' },
        include: {
          exam_marks: {
            include: {
              exam_subject_mapping: {
                include: {
                  exams: true,
                  subjects: true,
                },
              },
            },
          },
          students: { include: STUDENT_INCLUDE },
          faculty: { select: FACULTY_SELECT },
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching revaluation requests', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let request: any;

    try {
      request = await this.prisma.revaluation_requests.findUnique({
        where: { id },
        include: {
          exam_marks: {
            include: {
              exam_subject_mapping: {
                include: {
                  exams: true,
                  subjects: true,
                },
              },
            },
          },
          students: { include: STUDENT_INCLUDE },
          faculty: { select: FACULTY_SELECT },
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching revaluation request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!request) {
      throw new NotFoundException({
        message: 'Revaluation request not found.',
        errorCode: 'REVALUATION_REQUEST_NOT_FOUND',
      });
    }

    return request;
  }

  async update(id: number, updateRevaluationDto: UpdateRevaluationDto) {
    const existing = await this.prisma.revaluation_requests.findUnique({
      where: { id },
      include: { exam_marks: true },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Revaluation request not found.',
        errorCode: 'REVALUATION_REQUEST_NOT_FOUND',
      });
    }

    const { status, revised_marks, evaluator_faculty_id } = updateRevaluationDto;

    // Was previously hard-locked to "only while status === requested", so
    // approved/rejected (real enum values) could never actually be reached —
    // this is the missing final step, not a schema change. requested can go
    // straight to any state (COE can reject outright, or fast-track a
    // straightforward one); once under_review/revised/no_change, only the
    // final approve/reject remains; approved/rejected is terminal.
    const ALLOWED_NEXT: Record<string, string[]> = {
      requested: ['under_review', 'revised', 'no_change', 'approved', 'rejected'],
      under_review: ['revised', 'no_change', 'approved', 'rejected'],
      revised: ['approved', 'rejected'],
      no_change: ['approved', 'rejected'],
    };

    if (status !== undefined) {
      const allowed = ALLOWED_NEXT[existing.status];
      if (!allowed || !allowed.includes(status)) {
        throw new ConflictException({
          message: allowed
            ? `Cannot move from "${existing.status}" to "${status}". Allowed: ${allowed.join(', ')}.`
            : 'This revaluation request has already been processed.',
          errorCode: 'REVALUATION_INVALID_TRANSITION',
        });
      }
    } else if (existing.status === 'approved' || existing.status === 'rejected') {
      throw new ConflictException({
        message: 'This revaluation request has already been processed.',
        errorCode: 'REVALUATION_ALREADY_PROCESSED',
      });
    }

    if (revised_marks !== undefined) {
      if (revised_marks < 0) {
        throw new UnprocessableEntityException({
          message: 'revised_marks cannot be negative.',
          errorCode: 'INVALID_REVISED_MARKS',
        });
      }

      if (revised_marks > Number(existing.exam_marks.max_marks)) {
        throw new UnprocessableEntityException({
          message: 'revised_marks cannot exceed max_marks.',
          errorCode: 'INVALID_REVISED_MARKS',
        });
      }
    }

    if (evaluator_faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({ where: { id: evaluator_faculty_id } });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found.',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    try {
      const updated = await this.prisma.revaluation_requests.update({
        where: { id },
        data: {
          status,
          revised_marks,
          evaluator_faculty_id,
          resolved_at: status === 'approved' || status === 'rejected' ? new Date() : undefined,
        },
      });

      // The whole point of a revaluation/retotaling is a corrected official
      // mark — approving one without writing it back to exam_marks would
      // leave Results Management, Pass Board and the grade matrix all
      // showing the pre-revaluation score.
      const finalMarks = updated.revised_marks ?? existing.revised_marks;
      if (status === 'approved' && finalMarks != null) {
        await this.prisma.exam_marks.update({
          where: { id: existing.exam_marks_id },
          data: { marks_obtained: finalMarks, is_moderated: true },
        });
      }

      return updated;
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Revaluation request not found.',
          errorCode: 'REVALUATION_REQUEST_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating revaluation request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.revaluation_requests.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Revaluation request not found.',
        errorCode: 'REVALUATION_REQUEST_NOT_FOUND',
      });
    }

    try {
      await this.prisma.revaluation_requests.delete({ where: { id } });
      return { id };
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Revaluation request not found.',
          errorCode: 'REVALUATION_REQUEST_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting revaluation request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async publishRevaluation(examId: number, publishedByUserId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });

    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const originalPublication = await this.prisma.result_publications.findFirst(
      {
        where: { exam_id: examId, publication_type: 'original' },
      },
    );

    if (!originalPublication) {
      throw new ConflictException({
        message: 'Original results have not been published for this exam.',
        errorCode: 'ORIGINAL_NOT_PUBLISHED',
      });
    }

    const resolvedRequest = await this.prisma.revaluation_requests.findFirst({
      where: {
        status: 'revised',
        revised_marks: { not: null },
        exam_marks: {
          exam_subject_mapping: { exam_id: examId },
        },
      },
    });

    if (!resolvedRequest) {
      throw new UnprocessableEntityException({
        message: 'No resolved revaluation requests found for this exam.',
        errorCode: 'REVALUATION_INCOMPLETE',
      });
    }

    const existingRevaluationPublication =
      await this.prisma.result_publications.findFirst({
        where: { exam_id: examId, publication_type: 'revaluation' },
      });

    if (existingRevaluationPublication) {
      throw new ConflictException({
        message:
          'Revaluation results have already been published for this exam.',
        errorCode: 'ALREADY_PUBLISHED',
      });
    }

    try {
      return await this.prisma.result_publications.create({
        data: {
          exam_id: examId,
          publication_type: 'revaluation',
          published_by_user_id: publishedByUserId,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while publishing revaluation results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
