import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRevaluationWindowDto } from './dto/create-revaluation-window.dto';
import { UpdateRevaluationWindowDto } from './dto/update-revaluation-window.dto';

@Injectable()
export class RevaluationWindowsService {
  private readonly logger = new Logger(RevaluationWindowsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByExam(examId: number) {
    const window = await this.prisma.revaluation_windows.findUnique({
      where: { exam_id: examId },
    });

    if (!window) {
      throw new NotFoundException({
        message: 'No revaluation window configured for this exam.',
        errorCode: 'REVALUATION_WINDOW_NOT_FOUND',
      });
    }

    return window;
  }

  async create(dto: CreateRevaluationWindowDto, createdByUserId: number) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const existing = await this.prisma.revaluation_windows.findUnique({
      where: { exam_id: dto.exam_id },
    });
    if (existing) {
      throw new ConflictException({
        message:
          'A revaluation window already exists for this exam. Use PATCH to update it.',
        errorCode: 'REVALUATION_WINDOW_EXISTS',
      });
    }

    try {
      return await this.prisma.revaluation_windows.create({
        data: {
          exam_id: dto.exam_id,
          application_type: dto.application_type,
          is_open: dto.is_open ?? false,
          opens_at: dto.opens_at ? new Date(dto.opens_at) : undefined,
          closes_at: dto.closes_at ? new Date(dto.closes_at) : undefined,
          fee_per_paper: dto.fee_per_paper,
          photocopy_fee_per_paper: dto.photocopy_fee_per_paper,
          max_papers_per_student: dto.max_papers_per_student,
          created_by_user_id: createdByUserId,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while creating revaluation window', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async update(examId: number, dto: UpdateRevaluationWindowDto) {
    const existing = await this.prisma.revaluation_windows.findUnique({
      where: { exam_id: examId },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'No revaluation window configured for this exam.',
        errorCode: 'REVALUATION_WINDOW_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.revaluation_windows.update({
        where: { exam_id: examId },
        data: {
          application_type: dto.application_type,
          is_open: dto.is_open,
          opens_at:
            dto.opens_at !== undefined ? new Date(dto.opens_at) : undefined,
          closes_at:
            dto.closes_at !== undefined ? new Date(dto.closes_at) : undefined,
          fee_per_paper: dto.fee_per_paper,
          photocopy_fee_per_paper: dto.photocopy_fee_per_paper,
          max_papers_per_student: dto.max_papers_per_student,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while updating revaluation window', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
