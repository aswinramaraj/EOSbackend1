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
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateRevaluationDto } from './dto/create-revaluation.dto';
import { UpdateRevaluationDto } from './dto/update-revaluation.dto';

const VALID_STATUSES = ['requested', 'under_review', 'revised', 'no_change'];

@Injectable()
export class RevaluationService {
  private readonly logger = new Logger(RevaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

    let request;
    try {
      request = await this.prisma.revaluation_requests.create({
        data: { exam_marks_id, student_id },
      });
    } catch (err: any) {
      this.logger.error('DB error while creating revaluation request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    // COE is a single global role with no per-request assignee (unlike an
    // HoD, there's no one department to route this to) - broadcast to
    // every COE-role account rather than picking just one.
    await this.notifyRoleOfNewRequest(request.id, student.student_id_no);

    return request;
  }

  private async notifyRoleOfNewRequest(requestId: number, studentIdNo: string): Promise<void> {
    try {
      const coeUsers = await this.prisma.users.findMany({
        where: { roles: { name: ROLES.COE } },
        select: { id: true },
      });
      for (const u of coeUsers) {
        await this.notifications.notify({
          user_id: u.id,
          title: 'New revaluation request',
          message: `Student ${studentIdNo} has requested a revaluation.`,
          type: 'approval_request_pending',
          related_entity_type: 'revaluation_request',
          related_entity_id: requestId,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to notify COE of revaluation request ${requestId}`, err);
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
          students: true,
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
          students: true,
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

    if (existing.status !== 'requested') {
      throw new ConflictException({
        message: 'This revaluation request has already been processed.',
        errorCode: 'REVALUATION_ALREADY_PROCESSED',
      });
    }

    const { status, revised_marks } = updateRevaluationDto;

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

    let updated;
    try {
      updated = await this.prisma.revaluation_requests.update({
        where: { id },
        data: {
          status,
          revised_marks,
          resolved_at: new Date(),
        },
      });
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

    if (status !== undefined) {
      await this.notifyStudentOfDecision(existing.student_id, id, status, revised_marks);
    }

    return updated;
  }

  private async notifyStudentOfDecision(
    studentId: number,
    requestId: number,
    status: string,
    revisedMarks: number | undefined,
  ): Promise<void> {
    try {
      const student = await this.prisma.students.findUnique({
        where: { id: studentId },
        select: { user_id: true },
      });
      if (!student) return;

      const message =
        status === 'revised'
          ? `Your revaluation request has been resolved - revised marks: ${revisedMarks}.`
          : status === 'no_change'
            ? 'Your revaluation request has been resolved - no change to your marks.'
            : `Your revaluation request status is now ${status}.`;

      await this.notifications.notify({
        user_id: student.user_id,
        title: 'Revaluation request updated',
        message,
        type:
          status === 'revised' || status === 'no_change'
            ? 'approval_request_approved'
            : 'approval_request_pending',
        related_entity_type: 'revaluation_request',
        related_entity_id: requestId,
      });
    } catch (err) {
      this.logger.error(`Failed to notify student of revaluation decision ${requestId}`, err);
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
