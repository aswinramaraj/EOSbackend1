import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateFeeConcessionDto } from './dto/create-fee-concession.dto';
import { UpdateFeeConcessionDto } from './dto/update-fee-concession.dto';

@Injectable()
export class FeeConcessionService {
  private readonly logger = new Logger(FeeConcessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /fee-concessions
   */
  async findAll() {
    try {
      return await this.prisma.fee_concessions.findMany({
        orderBy: [{ fee_structure_id: 'asc' }, { id: 'asc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee concessions', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /fee-concessions/:id
   *
   * Error cases:
   *  404 FEE_CONCESSION_NOT_FOUND – no concession with the given id
   */
  async findOne(id: number) {
    const concession = await this.findById(id);

    if (!concession) {
      throw new NotFoundException({
        message: 'Fee concession not found',
        errorCode: 'FEE_CONCESSION_NOT_FOUND',
      });
    }

    return concession;
  }

  /**
   * GET /fee-structures/:id/concessions
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   */
  async findAllForFeeStructure(feeStructureId: number) {
    await this.assertFeeStructureExists(feeStructureId);

    try {
      return await this.prisma.fee_concessions.findMany({
        where: { fee_structure_id: feeStructureId },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee concessions', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /fee-structures/:id/concessions
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND   – no fee structure with the given id
   *  422 CONCESSION_EXCEEDS_TOTAL  – concession_amount exceeds the total fee structure amount
   */
  async create(feeStructureId: number, dto: CreateFeeConcessionDto) {
    await this.assertFeeStructureExists(feeStructureId);
    await this.assertWithinTotal(feeStructureId, dto.concession_amount);

    try {
      return await this.prisma.fee_concessions.create({
        data: {
          fee_structure_id: feeStructureId,
          concession_amount: dto.concession_amount,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating fee concession', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PUT/PATCH /fee-concessions/:id
   *
   * Only concession_amount may be updated.
   * fee_structure_id, is_settled and settled_date belong to the settlement
   * workflow and are not editable here.
   *
   * Error cases:
   *  404 FEE_CONCESSION_NOT_FOUND  – no concession with the given id
   *  422 CONCESSION_EXCEEDS_TOTAL  – concession_amount exceeds the total fee structure amount
   */
  async update(id: number, dto: UpdateFeeConcessionDto) {
    const concession = await this.findById(id);

    if (!concession) {
      throw new NotFoundException({
        message: 'Fee concession not found',
        errorCode: 'FEE_CONCESSION_NOT_FOUND',
      });
    }

    await this.assertWithinTotal(
      concession.fee_structure_id,
      dto.concession_amount,
    );

    try {
      return await this.prisma.fee_concessions.update({
        where: { id },
        data: { concession_amount: dto.concession_amount },
      });
    } catch (err) {
      this.logger.error('DB error while updating fee concession', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /fee-concessions/:id
   *
   * Error cases:
   *  404 FEE_CONCESSION_NOT_FOUND – no concession with the given id
   */
  async remove(id: number) {
    const concession = await this.findById(id);

    if (!concession) {
      throw new NotFoundException({
        message: 'Fee concession not found',
        errorCode: 'FEE_CONCESSION_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.fee_concessions.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting fee concession', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertFeeStructureExists(feeStructureId: number) {
    let feeStructure: unknown;

    try {
      feeStructure = await this.prisma.fee_structures.findUnique({
        where: { id: feeStructureId },
      });
    } catch (err) {
      this.logger.error('DB error during fee structure lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!feeStructure) {
      throw new NotFoundException({
        message: 'Fee structure not found',
        errorCode: 'FEE_STRUCTURE_NOT_FOUND',
      });
    }
  }

  private async assertWithinTotal(
    feeStructureId: number,
    concessionAmount: number,
  ) {
    const totalAmount = await this.sumFeeStructureItemsAmount(feeStructureId);

    if (concessionAmount > totalAmount) {
      throw new UnprocessableEntityException({
        message:
          'Concession amount cannot exceed the total fee structure amount',
        errorCode: 'CONCESSION_EXCEEDS_TOTAL',
      });
    }
  }

  private async sumFeeStructureItemsAmount(
    feeStructureId: number,
  ): Promise<number> {
    try {
      const result = await this.prisma.fee_structure_items.aggregate({
        where: { fee_structure_id: feeStructureId },
        _sum: { amount: true },
      });

      return Number(result._sum.amount ?? 0);
    } catch (err) {
      this.logger.error('DB error while summing fee structure items', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.fee_concessions.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during fee concession lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
