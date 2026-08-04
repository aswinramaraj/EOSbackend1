import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateTransportStageDto } from './dto/update-transport-stage.dto';

@Injectable()
export class TransportStageService {
  private readonly logger = new Logger(TransportStageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /transport-stages
   */
  async findAll() {
    try {
      return await this.prisma.transport_stages.findMany({
        orderBy: [{ route_id: 'asc' }, { sequence_no: 'asc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching transport stages', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /transport-stages/:id
   *
   * Error cases:
   *  404 TRANSPORT_STAGE_NOT_FOUND – no stage with the given id
   */
  async findOne(id: number) {
    const stage = await this.findById(id);

    if (!stage) {
      throw new NotFoundException({
        message: 'Transport stage not found',
        errorCode: 'TRANSPORT_STAGE_NOT_FOUND',
      });
    }

    return stage;
  }

  /**
   * PUT/PATCH /transport-stages/:id
   *
   * Only stage_name, sequence_no and fee_amount may be updated.
   * route_id is immutable — the stage remains attached to its original route.
   *
   * Error cases:
   *  404 TRANSPORT_STAGE_NOT_FOUND – no stage with the given id
   *  409 TRANSPORT_STAGE_EXISTS    – another stage in the same route already uses this sequence_no
   */
  async update(id: number, dto: UpdateTransportStageDto) {
    const stage = await this.findById(id);

    if (!stage) {
      throw new NotFoundException({
        message: 'Transport stage not found',
        errorCode: 'TRANSPORT_STAGE_NOT_FOUND',
      });
    }

    if (
      dto.sequence_no !== undefined &&
      dto.sequence_no !== stage.sequence_no
    ) {
      await this.assertSequenceNoAvailable(stage.route_id, dto.sequence_no, id);
    }

    try {
      return await this.prisma.transport_stages.update({
        where: { id },
        data: {
          stage_name: dto.stage_name,
          sequence_no: dto.sequence_no,
          fee_amount: dto.fee_amount,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating transport stage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /transport-stages/:id
   *
   * Error cases:
   *  404 TRANSPORT_STAGE_NOT_FOUND – no stage with the given id
   *  409 TRANSPORT_STAGE_IN_USE    – stage is referenced by student_transport_mapping
   */
  async remove(id: number) {
    const stage = await this.findById(id);

    if (!stage) {
      throw new NotFoundException({
        message: 'Transport stage not found',
        errorCode: 'TRANSPORT_STAGE_NOT_FOUND',
      });
    }

    let usageCounts: number[];

    try {
      usageCounts = await Promise.all([
        this.prisma.student_transport_mapping.count({
          where: { boarding_stage_id: id },
        }),
        this.prisma.student_transport_mapping.count({
          where: { destination_stage_id: id },
        }),
      ]);
    } catch (err) {
      this.logger.error('DB error while checking transport stage usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCounts.some((count) => count > 0)) {
      throw new ConflictException({
        message: 'This transport stage is in use and cannot be deleted',
        errorCode: 'TRANSPORT_STAGE_IN_USE',
      });
    }

    try {
      return await this.prisma.transport_stages.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting transport stage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertSequenceNoAvailable(
    routeId: number,
    sequenceNo: number,
    excludeId: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.transport_stages.findUnique({
        where: {
          route_id_sequence_no: { route_id: routeId, sequence_no: sequenceNo },
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('DB error during transport stage duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message:
          'A stage with this sequence number already exists for this route',
        errorCode: 'TRANSPORT_STAGE_EXISTS',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.transport_stages.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during transport stage lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
