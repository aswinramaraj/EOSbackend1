import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateRevaluationWindowDto } from './dto/update-revaluation-window.dto';

@Injectable()
export class RevaluationWindowsService {
  private readonly logger = new Logger(RevaluationWindowsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreate(examId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    try {
      const existing = await this.prisma.revaluation_windows.findUnique({
        where: { exam_id: examId },
      });
      if (existing) return existing;

      return await this.prisma.revaluation_windows.create({
        data: { exam_id: examId, fee_per_paper: 0, photocopy_fee_per_paper: 0 },
      });
    } catch (err) {
      this.logger.error('DB error while loading revaluation window', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async get(examId: number) {
    return this.getOrCreate(examId);
  }

  async update(examId: number, dto: UpdateRevaluationWindowDto) {
    const row = await this.getOrCreate(examId);

    try {
      return await this.prisma.revaluation_windows.update({
        where: { id: row.id },
        data: {
          application_type: dto.application_type,
          opens_at: dto.opens_at ? new Date(dto.opens_at) : undefined,
          closes_at: dto.closes_at ? new Date(dto.closes_at) : undefined,
          fee_per_paper: dto.fee_per_paper,
          photocopy_fee_per_paper: dto.photocopy_fee_per_paper,
          max_papers_per_student: dto.max_papers_per_student,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating revaluation window', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Senior-COE only, enforced at the controller. */
  async toggle(examId: number) {
    const row = await this.getOrCreate(examId);

    try {
      return await this.prisma.revaluation_windows.update({
        where: { id: row.id },
        data: { is_open: !row.is_open },
      });
    } catch (err) {
      this.logger.error('DB error while toggling revaluation window', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
