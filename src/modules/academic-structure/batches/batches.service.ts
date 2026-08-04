import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBatchDto) {
    if (dto.end_year < dto.start_year) {
      throw new UnprocessableEntityException({
        message: 'end_year must not be earlier than start_year',
        errorCode: 'INVALID_YEAR_RANGE',
      });
    }

    const existing = await this.prisma.batches.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Batch name already exists',
        errorCode: 'BATCH_NAME_EXISTS',
      });
    }

    try {
      return await this.prisma.batches.create({
        data: {
          name: dto.name,
          start_year: dto.start_year,
          end_year: dto.end_year,
        },
      });
    } catch (err) {
      this.logger.error(
        'DB error creating batch',
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    return await this.prisma.batches.findMany({
      orderBy: { start_year: 'desc' },
    });
  }

  async findOne(id: number) {
    const batch = await this.prisma.batches.findUnique({ where: { id } });
    if (!batch) {
      throw new NotFoundException({
        message: 'Batch not found',
        errorCode: 'NOT_FOUND',
      });
    }
    return batch;
  }

  async update(id: number, dto: UpdateBatchDto) {
    const batch = await this.findOne(id);

    const nextStartYear = dto.start_year ?? batch.start_year;
    const nextEndYear = dto.end_year ?? batch.end_year;
    if (nextEndYear < nextStartYear) {
      throw new UnprocessableEntityException({
        message: 'end_year must not be earlier than start_year',
        errorCode: 'INVALID_YEAR_RANGE',
      });
    }

    if (dto.name && dto.name !== batch.name) {
      const existing = await this.prisma.batches.findUnique({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException({
          message: 'Batch name already exists',
          errorCode: 'BATCH_NAME_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.batches.update({
        where: { id },
        data: {
          name: dto.name,
          start_year: dto.start_year,
          end_year: dto.end_year,
        },
      });
    } catch (err) {
      this.logger.error(
        `DB error updating batch #${id}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    await this.findOne(id);

    try {
      await this.prisma.batches.delete({ where: { id } });
      return { message: 'Batch deleted successfully' };
    } catch (err: any) {
      if (err?.code === 'P2003') {
        throw new ConflictException({
          message:
            'Batch cannot be deleted while classes, students, or other records reference it',
          errorCode: 'BATCH_IN_USE',
        });
      }
      this.logger.error(
        `DB error deleting batch #${id}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
