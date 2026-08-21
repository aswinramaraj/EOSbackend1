import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, fee_structure_applies_to_enum } from '../../../../generated/prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateFeeStructureItemDto } from './dto/create-fee-structure-item.dto';
import { UpdateFeeStructureItemDto } from './dto/update-fee-structure-item.dto';

type ItemIdField = 'demand_category_id' | 'hostel_room_type_id' | 'transport_stage_id';

@Injectable()
export class FeeStructureItemService {
  private readonly logger = new Logger(FeeStructureItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * GET /fee-structure-items
   */
  async findAll() {
    try {
      return await this.prisma.fee_structure_items.findMany({
        orderBy: [{ fee_structure_id: 'asc' }, { id: 'asc' }],
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
    const feeStructure = await this.findFeeStructureOrThrow(feeStructureId);

    try {
      return await this.prisma.fee_structure_items.findMany({
        where: { fee_structure_id: feeStructureId },
        orderBy: { [this.itemIdFieldForAppliesTo(feeStructure.applies_to)]: 'asc' },
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
   * Which id field the item must carry (demand_category_id /
   * hostel_room_type_id / transport_stage_id) is dictated by the parent fee
   * structure's applies_to — same rule as POST /fee-structures.
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND              – no fee structure with the given id
   *  422 INVALID_FEE_STRUCTURE_ITEM_SOURCE    – item doesn't carry the id matching applies_to
   *  404 DEMAND_CATEGORY_NOT_FOUND            – the referenced id doesn't exist
   *  409 FEE_STRUCTURE_ITEM_EXISTS            – this fee structure already has an item for this source
   */
  async create(
    feeStructureId: number,
    dto: CreateFeeStructureItemDto,
    performedByUserId: number,
  ) {
    const feeStructure = await this.findFeeStructureOrThrow(feeStructureId);
    const idField = this.itemIdFieldForAppliesTo(feeStructure.applies_to);
    const sourceId = this.requireSourceId(dto, idField);

    await this.assertSourceExists(idField, sourceId);
    await this.assertNoDuplicate(idField, feeStructureId, sourceId);

    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const item = await tx.fee_structure_items.create({
          data: {
            fee_structure_id: feeStructureId,
            demand_category_id: idField === 'demand_category_id' ? sourceId : null,
            hostel_room_type_id: idField === 'hostel_room_type_id' ? sourceId : null,
            transport_stage_id: idField === 'transport_stage_id' ? sourceId : null,
            amount: dto.amount,
          },
        });

        await this.recalculateFeeStructureDemand(tx, feeStructureId);

        return item;
      });

      await this.auditLog.record({
        entity_type: 'fee_structure_item',
        entity_id: item.id,
        action: 'created',
        performed_by_user_id: performedByUserId,
        new_value: {
          fee_structure_id: item.fee_structure_id,
          amount: item.amount.toString(),
          [idField]: sourceId,
        },
      });

      return item;
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
   * fee_structure_id is immutable, so the item stays scoped to its original
   * fee structure's applies_to — only that source id field, and amount, may
   * be updated.
   *
   * Error cases:
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND         – no item with the given id
   *  422 INVALID_FEE_STRUCTURE_ITEM_SOURCE    – wrong id field for this item's fee structure
   *  404 DEMAND_CATEGORY_NOT_FOUND            – the referenced id doesn't exist
   *  409 FEE_STRUCTURE_ITEM_EXISTS            – this fee structure already has an item for this source
   */
  async update(
    id: number,
    dto: UpdateFeeStructureItemDto,
    performedByUserId: number,
  ) {
    const item = await this.findById(id);

    if (!item) {
      throw new NotFoundException({
        message: 'Fee structure item not found',
        errorCode: 'FEE_STRUCTURE_ITEM_NOT_FOUND',
      });
    }

    const feeStructure = await this.findFeeStructureOrThrow(item.fee_structure_id);
    const idField = this.itemIdFieldForAppliesTo(feeStructure.applies_to);
    const incoming = dto[idField];
    const currentSourceId = item[idField];

    let sourceId = currentSourceId ?? undefined;
    if (incoming !== undefined && incoming !== currentSourceId) {
      await this.assertSourceExists(idField, incoming);
      await this.assertNoDuplicate(idField, item.fee_structure_id, incoming, id);
      sourceId = incoming;
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.fee_structure_items.update({
          where: { id },
          data: {
            [idField]: sourceId,
            amount: dto.amount,
          },
        });

        await this.recalculateFeeStructureDemand(tx, item.fee_structure_id);

        return updated;
      });

      await this.auditLog.record({
        entity_type: 'fee_structure_item',
        entity_id: updated.id,
        action: 'updated',
        performed_by_user_id: performedByUserId,
        old_value: { amount: item.amount.toString(), [idField]: currentSourceId },
        new_value: { amount: updated.amount.toString(), [idField]: sourceId },
      });

      return updated;
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
  async remove(id: number, performedByUserId: number) {
    const item = await this.findById(id);

    if (!item) {
      throw new NotFoundException({
        message: 'Fee structure item not found',
        errorCode: 'FEE_STRUCTURE_ITEM_NOT_FOUND',
      });
    }

    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.fee_structure_items.delete({
          where: { id },
        });

        await this.recalculateFeeStructureDemand(tx, item.fee_structure_id);

        return deleted;
      });

      await this.auditLog.record({
        entity_type: 'fee_structure_item',
        entity_id: deleted.id,
        action: 'deleted',
        performed_by_user_id: performedByUserId,
        old_value: {
          fee_structure_id: deleted.fee_structure_id,
          amount: deleted.amount.toString(),
        },
      });

      return deleted;
    } catch (err) {
      this.logger.error('DB error while deleting fee structure item', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private itemIdFieldForAppliesTo(appliesTo: fee_structure_applies_to_enum): ItemIdField {
    switch (appliesTo) {
      case fee_structure_applies_to_enum.hostel:
        return 'hostel_room_type_id';
      case fee_structure_applies_to_enum.transport:
        return 'transport_stage_id';
      default:
        return 'demand_category_id';
    }
  }

  private requireSourceId(dto: CreateFeeStructureItemDto, idField: ItemIdField): number {
    const value = dto[idField];
    if (value == null) {
      throw new UnprocessableEntityException({
        message: `This item must have a ${idField}`,
        errorCode: 'INVALID_FEE_STRUCTURE_ITEM_SOURCE',
      });
    }
    return value;
  }

  private async assertSourceExists(idField: ItemIdField, sourceId: number) {
    let found: unknown;

    try {
      if (idField === 'hostel_room_type_id') {
        found = await this.prisma.hostel_room_types.findUnique({ where: { id: sourceId } });
      } else if (idField === 'transport_stage_id') {
        found = await this.prisma.transport_stages.findUnique({ where: { id: sourceId } });
      } else {
        found = await this.prisma.demand_categories.findUnique({ where: { id: sourceId } });
      }
    } catch (err) {
      this.logger.error('DB error during fee structure item source lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!found) {
      throw new NotFoundException({
        message: 'The referenced item source was not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }
  }

  private async assertNoDuplicate(
    idField: ItemIdField,
    feeStructureId: number,
    sourceId: number,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.fee_structure_items.findFirst({
        where: { fee_structure_id: feeStructureId, [idField]: sourceId },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('DB error during fee structure item duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'This fee structure already has an item for this source',
        errorCode: 'FEE_STRUCTURE_ITEM_EXISTS',
      });
    }
  }

  /**
   * Source-of-truth sync: Fee Structure Items → Student Fee Demand Mapping.
   * See fee-structure/fee-structure.service.ts create() for the full
   * rationale — kept identical here so both entry points into
   * fee_structure_items stay consistent.
   */
  private async recalculateFeeStructureDemand(
    tx: Prisma.TransactionClient,
    feeStructureId: number,
  ) {
    const result = await tx.fee_structure_items.aggregate({
      where: { fee_structure_id: feeStructureId },
      _sum: { amount: true },
    });

    const newTotal = result._sum.amount ?? new Prisma.Decimal(0);

    await tx.student_fee_demand_mapping.updateMany({
      where: { fee_structure_id: feeStructureId },
      data: { total_amount: newTotal },
    });
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

  private async findFeeStructureOrThrow(feeStructureId: number) {
    let feeStructure: { applies_to: fee_structure_applies_to_enum } | null;

    try {
      feeStructure = await this.prisma.fee_structures.findUnique({
        where: { id: feeStructureId },
        select: { applies_to: true },
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

    return feeStructure;
  }
}
