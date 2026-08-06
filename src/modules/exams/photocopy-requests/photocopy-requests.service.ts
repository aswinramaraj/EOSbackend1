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
import { paginate } from 'src/common/dto/pagination.dto';
import { getOpenRevaluationWindow } from 'src/common/utils/get-open-revaluation-window.util';
import { CreatePhotocopyRequestDto } from './dto/create-photocopy-request.dto';
import { FindPhotocopyRequestsQueryDto } from './dto/find-photocopy-requests-query.dto';

const REQUEST_INCLUDE = {
  students: { select: { id: true, student_id_no: true, roll_no: true } },
  exam_marks: {
    include: {
      exam_subject_mapping: { include: { subjects: true, exams: true } },
    },
  },
} as const;

@Injectable()
export class PhotocopyRequestsService {
  private readonly logger = new Logger(PhotocopyRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePhotocopyRequestDto, userId: number) {
    const student = await this.resolveStudentByUserId(userId);

    const examMark = await this.prisma.exam_marks.findUnique({
      where: { id: dto.exam_marks_id },
      include: { exam_subject_mapping: true },
    });
    if (!examMark) {
      throw new NotFoundException({
        message: 'Exam marks record not found.',
        errorCode: 'EXAM_MARKS_NOT_FOUND',
      });
    }
    if (examMark.student_id !== student.id) {
      throw new BadRequestException({
        message: 'This exam marks record does not belong to you.',
        errorCode: 'EXAM_MARKS_STUDENT_MISMATCH',
      });
    }

    const existing = await this.prisma.photocopy_requests.findFirst({
      where: { student_id: student.id, exam_marks_id: dto.exam_marks_id },
    });
    if (existing) {
      throw new ConflictException({
        message: 'A photocopy request already exists for this exam mark.',
        errorCode: 'PHOTOCOPY_REQUEST_EXISTS',
      });
    }

    const examId = examMark.exam_subject_mapping.exam_id;
    const window = await getOpenRevaluationWindow(
      this.prisma,
      examId,
      'photocopy',
    );

    if (window.max_papers_per_student !== null) {
      const existingCount = await this.prisma.photocopy_requests.count({
        where: {
          student_id: student.id,
          exam_marks: { exam_subject_mapping: { exam_id: examId } },
        },
      });
      if (existingCount >= window.max_papers_per_student) {
        throw new UnprocessableEntityException({
          message: `You may only request photocopies for up to ${window.max_papers_per_student} paper(s) for this exam.`,
          errorCode: 'MAX_PAPERS_EXCEEDED',
        });
      }
    }

    try {
      return await this.prisma.photocopy_requests.create({
        data: {
          student_id: student.id,
          exam_marks_id: dto.exam_marks_id,
          fee_amount: window.photocopy_fee_per_paper,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating photocopy request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOwn(userId: number, query: FindPhotocopyRequestsQueryDto) {
    const student = await this.resolveStudentByUserId(userId);
    query.student_id = student.id;
    return this.findAll(query);
  }

  async findAll(query: FindPhotocopyRequestsQueryDto) {
    const where = {
      student_id: query.student_id,
      exam_marks_id: query.exam_marks_id,
      status: query.status,
    };

    try {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.photocopy_requests.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { applied_at: 'desc' },
          include: REQUEST_INCLUDE,
        }),
        this.prisma.photocopy_requests.count({ where }),
      ]);

      return paginate(data, total, query);
    } catch (err) {
      this.logger.error('DB error while fetching photocopy requests', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    const request = await this.prisma.photocopy_requests.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException({
        message: 'Photocopy request not found.',
        errorCode: 'PHOTOCOPY_REQUEST_NOT_FOUND',
      });
    }
    return request;
  }

  async scan(id: number, userId: number) {
    return this.transition(id, 'requested', 'scanned', userId);
  }

  async issue(id: number, userId: number) {
    const existing = await this.getOrThrow(id);
    if (existing.status !== 'requested' && existing.status !== 'scanned') {
      throw new ConflictException({
        message: 'This photocopy request has already been processed.',
        errorCode: 'PHOTOCOPY_ALREADY_PROCESSED',
      });
    }
    return this.updateStatus(id, 'issued', userId);
  }

  async reject(id: number, userId: number) {
    const existing = await this.getOrThrow(id);
    if (existing.status === 'issued' || existing.status === 'rejected') {
      throw new ConflictException({
        message: 'This photocopy request has already been processed.',
        errorCode: 'PHOTOCOPY_ALREADY_PROCESSED',
      });
    }
    return this.updateStatus(id, 'rejected', userId);
  }

  private async transition(
    id: number,
    fromStatus: string,
    toStatus: 'scanned' | 'issued' | 'rejected',
    userId: number,
  ) {
    const existing = await this.getOrThrow(id);
    if (existing.status !== fromStatus) {
      throw new ConflictException({
        message: `This photocopy request is not in the '${fromStatus}' state.`,
        errorCode: 'PHOTOCOPY_INVALID_TRANSITION',
      });
    }
    return this.updateStatus(id, toStatus, userId);
  }

  private async updateStatus(
    id: number,
    status: 'scanned' | 'issued' | 'rejected',
    userId: number,
  ) {
    try {
      return await this.prisma.photocopy_requests.update({
        where: { id },
        data: {
          status,
          processed_by_user_id: userId,
          processed_at: new Date(),
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating photocopy request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getOrThrow(id: number) {
    const request = await this.prisma.photocopy_requests.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'Photocopy request not found.',
        errorCode: 'PHOTOCOPY_REQUEST_NOT_FOUND',
      });
    }
    return request;
  }

  private async resolveStudentByUserId(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for the authenticated user',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return student;
  }
}
