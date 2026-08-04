import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateFeeStructureItemDto } from './dto/create-fee-structure-item.dto';
import { UpdateFeeStructureItemDto } from './dto/update-fee-structure-item.dto';

@Injectable()
export class FeeStructureItemService {
  private readonly logger = new Logger(FeeStructureItemService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /fee-structure-items
   */
  async findAll() {
    try {
      return await this.prisma.fee_structure_items.findMany({
        orderBy: [{ fee_structure_id: 'asc' }, { demand_category_id: 'asc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee structure items', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /fee-structure-items/:id
   *
   * Error cases:
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND – no item with the given id
   */
  async findOne(id: number) {
    const item = await this.findById(id);

    if (!item) {
      throw new NotFoundException({
        message: 'Fee structure item not found',
        errorCode: 'FEE_STRUCTURE_ITEM_NOT_FOUND',
      });
    }

    return item;
  }

  /**
   * GET /fee-structures/:id/items
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   */
  async findAllForFeeStructure(feeStructureId: number) {
    await this.assertFeeStructureExists(feeStructureId);

    try {
      return await this.prisma.fee_structure_items.findMany({
        where: { fee_structure_id: feeStructureId },
        orderBy: { demand_category_id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee structure items', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /fee-structures/:id/items
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND     – no fee structure with the given id
   *  404 DEMAND_CATEGORY_NOT_FOUND   – demand_category_id does not exist
   *  409 FEE_STRUCTURE_ITEM_EXISTS   – this fee structure already has an item for this demand category
   */
  async create(feeStructureId: number, dto: CreateFeeStructureItemDto) {
    await this.assertFeeStructureExists(feeStructureId);
    await this.assertDemandCategoryExists(dto.demand_category_id);
    await this.assertNoDuplicate(feeStructureId, dto.demand_category_id);

    try {
      return await this.prisma.fee_structure_items.create({
        data: {
          fee_structure_id: feeStructureId,
          demand_category_id: dto.demand_category_id,
          amount: dto.amount,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating fee structure item', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PUT/PATCH /fee-structure-items/:id
   *
   * Only demand_category_id and amount may be updated.
   * fee_structure_id is immutable — the item remains attached to its original fee structure.
   *
   * Error cases:
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND – no item with the given id
   *  404 DEMAND_CATEGORY_NOT_FOUND    – demand_category_id does not exist
   *  409 FEE_STRUCTURE_ITEM_EXISTS    – this fee structure already has an item for this demand category
   */
  async update(id: number, dto: UpdateFeeStructureItemDto) {
    const item = await this.findById(id);

    if (!item) {
      throw new NotFoundException({
        message: 'Fee structure item not found',
        errorCode: 'FEE_STRUCTURE_ITEM_NOT_FOUND',
      });
    }

    if (
      dto.demand_category_id !== undefined &&
      dto.demand_category_id !== item.demand_category_id
    ) {
      await this.assertDemandCategoryExists(dto.demand_category_id);
      await this.assertNoDuplicate(
        item.fee_structure_id,
        dto.demand_category_id,
        id,
      );
    }

    try {
      return await this.prisma.fee_structure_items.update({
        where: { id },
        data: {
          demand_category_id: dto.demand_category_id,
          amount: dto.amount,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating fee structure item', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /fee-structure-items/:id
   *
   * Error cases:
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND – no item with the given id
   */
  async remove(id: number) {
    const item = await this.findById(id);

    if (!item) {
      throw new NotFoundException({
        message: 'Fee structure item not found',
        errorCode: 'FEE_STRUCTURE_ITEM_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.fee_structure_items.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting fee structure item', err);
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

  private async assertDemandCategoryExists(demandCategoryId: number) {
    let demandCategory: unknown;

    try {
      demandCategory = await this.prisma.demand_categories.findUnique({
        where: { id: demandCategoryId },
      });
    } catch (err) {
      this.logger.error('DB error during demand category lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!demandCategory) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }
  }

  private async assertNoDuplicate(
    feeStructureId: number,
    demandCategoryId: number,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.fee_structure_items.findUnique({
        where: {
          fee_structure_id_demand_category_id: {
            fee_structure_id: feeStructureId,
            demand_category_id: demandCategoryId,
          },
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during fee structure item duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message:
          'This fee structure already has an item for this demand category',
        errorCode: 'FEE_STRUCTURE_ITEM_EXISTS',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.fee_structure_items.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during fee structure item lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
