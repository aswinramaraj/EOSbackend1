import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAllocationBatchDto } from './dto/create-allocation-batch.dto';
import { ListAllocationBatchesQueryDto } from './dto/list-allocation-batches-query.dto';

@Injectable()
export class InvigilationAllocationBatchesService {
  private readonly logger = new Logger(
    InvigilationAllocationBatchesService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: returns the existing batch for this scope if one already exists. */
  async findOrCreate(dto: CreateAllocationBatchDto, userId: number) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const examDate = new Date(dto.exam_date);

    const existing =
      await this.prisma.invigilation_allocation_batches.findUnique({
        where: {
          exam_id_exam_date_session: {
            exam_id: dto.exam_id,
            exam_date: examDate,
            session: dto.session,
          },
        },
      });
    if (existing) return existing;

    try {
      return await this.prisma.invigilation_allocation_batches.create({
        data: {
          exam_id: dto.exam_id,
          exam_date: examDate,
          session: dto.session,
          created_by_user_id: userId,
        },
      });
    } catch (err) {
      this.logger.error(
        'DB error while creating invigilation allocation batch',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(query: ListAllocationBatchesQueryDto) {
    try {
      return await this.prisma.invigilation_allocation_batches.findMany({
        where: {
          exam_id: query.exam_id,
          exam_date: query.exam_date ? new Date(query.exam_date) : undefined,
          session: query.session,
          status: query.status,
        },
        orderBy: [{ exam_date: 'desc' }],
        include: { _count: { select: { invigilation_duties: true } } },
      });
    } catch (err) {
      this.logger.error(
        'DB error while fetching invigilation allocation batches',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    const batch = await this.getOrThrow(id, {
      invigilation_duties: {
        include: {
          faculty: { select: { id: true, first_name: true, last_name: true } },
          hall_plans: {
            select: { id: true, venues: { select: { id: true, name: true } } },
          },
        },
      },
    });
    return batch;
  }

  async submit(id: number) {
    const batch = await this.getOrThrow(id);
    if (batch.status !== 'draft') {
      throw new BadRequestException({
        message: 'Only a draft allocation can be submitted.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    const dutyCount = await this.prisma.invigilation_duties.count({
      where: { allocation_batch_id: id },
    });
    if (dutyCount === 0) {
      throw new BadRequestException({
        message:
          'Cannot submit an empty invigilator allocation — assign at least one duty first.',
        errorCode: 'EMPTY_BATCH',
      });
    }

    return this.prisma.invigilation_allocation_batches.update({
      where: { id },
      data: { status: 'submitted' },
    });
  }

  /** Senior-COE only, enforced at the controller. */
  async publish(id: number, userId: number) {
    const batch = await this.getOrThrow(id);
    if (batch.status !== 'submitted') {
      throw new BadRequestException({
        message: 'Only a submitted allocation can be published.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    return this.prisma.invigilation_allocation_batches.update({
      where: { id },
      data: {
        status: 'published',
        published_by_user_id: userId,
        published_at: new Date(),
      },
    });
  }

  async remove(id: number) {
    const batch = await this.getOrThrow(id);
    if (batch.status !== 'draft') {
      throw new ConflictException({
        message: 'Only a draft allocation can be deleted.',
        errorCode: 'BATCH_NOT_DRAFT',
      });
    }

    const dutyCount = await this.prisma.invigilation_duties.count({
      where: { allocation_batch_id: id },
    });
    if (dutyCount > 0) {
      throw new ConflictException({
        message:
          'Cannot delete an allocation that already has duties assigned — unassign them first.',
        errorCode: 'BATCH_HAS_DUTIES',
      });
    }

    await this.prisma.invigilation_allocation_batches.delete({ where: { id } });
    return { id };
  }

  private async getOrThrow(id: number, include?: object) {
    let batch: any;
    try {
      batch = await this.prisma.invigilation_allocation_batches.findUnique({
        where: { id },
        include,
      });
    } catch (err) {
      this.logger.error(
        'DB error while fetching invigilation allocation batch',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!batch) {
      throw new NotFoundException({
        message: 'Invigilation allocation batch not found.',
        errorCode: 'ALLOCATION_BATCH_NOT_FOUND',
      });
    }

    return batch;
  }
}
