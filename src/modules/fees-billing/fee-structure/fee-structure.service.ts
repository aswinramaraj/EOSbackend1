import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { fee_structure_applies_to_enum } from '../../../../generated/prisma/client';
import { AddConcessionDto } from './dto/add-concession.dto';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { UpdateFeeStructureDto } from './dto/update-fee-structure.dto';

@Injectable()
export class FeeStructureService {
  private readonly logger = new Logger(FeeStructureService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /fee-structures
   *
   * Error cases:
   *  404 QUOTA_NOT_FOUND               – quota_id does not exist (applies_to = quota)
   *  404 DEMAND_CATEGORY_NOT_FOUND     – one or more demand_category_id do not exist
   *  422 DUPLICATE_DEMAND_CATEGORY     – same demand_category_id repeated in items
   *  500 INTERNAL_ERROR                – unexpected failure (DB, etc.)
   */
  async create(dto: CreateFeeStructureDto) {
    // ── 1. Validate quota only when applies_to requires it ──────────────────
    if (dto.applies_to === fee_structure_applies_to_enum.quota) {
      await this.assertQuotaExists(dto.quota_id);
    }

    // ── 2. Items must carry the id column matching applies_to, and no dupes ──
    const idField = this.itemIdFieldForAppliesTo(dto.applies_to);
    const ids = dto.items.map((item) => {
      const value = item[idField];
      if (value == null) {
        throw new UnprocessableEntityException({
          message: `Every item must have a ${idField} when applies_to is "${dto.applies_to}"`,
          errorCode: 'INVALID_FEE_STRUCTURE_ITEM_SOURCE',
        });
      }
      return value;
    });
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new UnprocessableEntityException({
        message: 'Duplicate items are not allowed',
        errorCode: 'DUPLICATE_DEMAND_CATEGORY',
      });
    }

    // ── 3. Validate every referenced id exists (single batch query) ─────────
    await this.assertItemSourcesExist(idField, [...uniqueIds]);

    // ── 4. Create fee structure, its items and any concessions in one tx ────
    try {
      return await this.prisma.$transaction(async (tx) => {
        const feeStructure = await tx.fee_structures.create({
          data: {
            name: dto.name,
            applies_to: dto.applies_to,
            quota_id: dto.quota_id,
            academic_year: dto.academic_year,
          },
        });

        const items = await Promise.all(
          dto.items.map((item) =>
            tx.fee_structure_items.create({
              data: {
                fee_structure_id: feeStructure.id,
                demand_category_id: item.demand_category_id ?? null,
                hostel_room_type_id: item.hostel_room_type_id ?? null,
                transport_stage_id: item.transport_stage_id ?? null,
                amount: item.amount,
              },
            }),
          ),
        );

        const concessions = await Promise.all(
          dto.items
            .filter((item) => item.concession_amount != null)
            .map((item) =>
              tx.fee_concessions.create({
                data: {
                  fee_structure_id: feeStructure.id,
                  concession_amount: item.concession_amount!,
                  is_settled: false,
                },
              }),
            ),
        );

        return {
          ...feeStructure,
          fee_structure_items: items,
          fee_concessions: concessions,
        };
      });
    } catch (err) {
      this.logger.error('DB error while creating fee structure', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /fee-structures/:id/concessions
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND    – no fee structure with the given id
   *  422 CONCESSION_EXCEEDS_TOTAL   – concession_amount exceeds the total fee structure amount
   *  500 INTERNAL_ERROR             – unexpected failure (DB, etc.)
   */
  async addConcession(id: number, dto: AddConcessionDto) {
    await this.assertFeeStructureExists(id);

    const totalAmount = await this.sumFeeStructureItemsAmount(id);

    if (dto.concession_amount > totalAmount) {
      throw new UnprocessableEntityException({
        message:
          'Concession amount cannot exceed the total fee structure amount',
        errorCode: 'CONCESSION_EXCEEDS_TOTAL',
      });
    }

    try {
      return await this.prisma.fee_concessions.create({
        data: {
          fee_structure_id: id,
          concession_amount: dto.concession_amount,
          is_settled: false,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating fee concession', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /fee-structures
   */
  async findAll() {
    try {
      return await this.prisma.fee_structures.findMany({
        include: { fee_structure_items: true, fee_concessions: true },
        orderBy: { created_at: 'desc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee structures', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /fee-structures/:id
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   */
  async findOne(id: number) {
    const feeStructure = await this.findFeeStructureOrThrow(id);
    return feeStructure;
  }

  /**
   * PUT /fee-structures/:id
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   *  404 QUOTA_NOT_FOUND         – quota_id does not exist (applies_to = quota)
   *  500 INTERNAL_ERROR          – unexpected failure (DB, etc.)
   */
  async update(id: number, dto: UpdateFeeStructureDto) {
    const feeStructure = await this.findFeeStructureOrThrow(id);

    // ── Validate quota only when the resulting applies_to requires it ───────
    const appliesTo = dto.applies_to ?? feeStructure.applies_to;
    if (appliesTo === fee_structure_applies_to_enum.quota) {
      await this.assertQuotaExists(
        dto.quota_id ?? feeStructure.quota_id ?? undefined,
      );
    }

    try {
      return await this.prisma.fee_structures.update({
        where: { id },
        data: {
          name: dto.name,
          applies_to: dto.applies_to,
          quota_id: dto.quota_id,
          academic_year: dto.academic_year,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating fee structure', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /fee-structures/:id
   *
   * Error cases:
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   *  409 FEE_STRUCTURE_IN_USE    – fee structure is referenced by student mappings
   *  500 INTERNAL_ERROR          – unexpected failure (DB, etc.)
   */
  async remove(id: number) {
    await this.findFeeStructureOrThrow(id);
    await this.assertFeeStructureNotInUse(id);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.fee_concessions.deleteMany({
          where: { fee_structure_id: id },
        });
        return tx.fee_structures.delete({ where: { id } });
      });
    } catch (err) {
      this.logger.error('DB error while deleting fee structure', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findFeeStructureOrThrow(id: number) {
    let feeStructure: Awaited<
      ReturnType<typeof this.prisma.fee_structures.findUnique>
    >;

    try {
      feeStructure = await this.prisma.fee_structures.findUnique({
        where: { id },
        include: { fee_structure_items: true, fee_concessions: true },
      });
    } catch (err) {
      this.logger.error('DB error during fee structure lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
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

  private async assertFeeStructureNotInUse(id: number) {
    let usageCounts: number[];

    try {
      usageCounts = await Promise.all([
        this.prisma.student_fee_demand_mapping.count({
          where: { fee_structure_id: id },
        }),
        this.prisma.student_hostel_mapping.count({
          where: { fee_structure_id: id },
        }),
        this.prisma.student_transport_mapping.count({
          where: { fee_structure_id: id },
        }),
      ]);
    } catch (err) {
      this.logger.error('DB error while checking fee structure usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCounts.some((count) => count > 0)) {
      throw new ConflictException({
        message: 'This fee structure is in use and cannot be deleted',
        errorCode: 'FEE_STRUCTURE_IN_USE',
      });
    }
  }

  private async assertFeeStructureExists(id: number) {
    let feeStructure: unknown;

    try {
      feeStructure = await this.prisma.fee_structures.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during fee structure lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
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
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertQuotaExists(quotaId?: number) {
    if (!quotaId) {
      throw new NotFoundException({
        message: 'Quota not found',
        errorCode: 'QUOTA_NOT_FOUND',
      });
    }

    let quota: unknown;

    try {
      quota = await this.prisma.quotas.findUnique({ where: { id: quotaId } });
    } catch (err) {
      this.logger.error('DB error during quota lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!quota) {
      throw new NotFoundException({
        message: 'Quota not found',
        errorCode: 'QUOTA_NOT_FOUND',
      });
    }
  }

  /**
   * Which fee_structure_items column an item is expected to carry, based on
   * the parent fee structure's applies_to. Kept in one place so create()
   * validation and item creation always agree on the mapping:
   *   quota     -> demand_category_id  (tuition/exam/etc. demand categories)
   *   hostel    -> hostel_room_type_id (room type this hostel fee is for)
   *   transport -> transport_stage_id  (boarding stage this fare is for)
   */
  private itemIdFieldForAppliesTo(
    appliesTo: fee_structure_applies_to_enum,
  ): 'demand_category_id' | 'hostel_room_type_id' | 'transport_stage_id' {
    switch (appliesTo) {
      case fee_structure_applies_to_enum.hostel:
        return 'hostel_room_type_id';
      case fee_structure_applies_to_enum.transport:
        return 'transport_stage_id';
      default:
        return 'demand_category_id';
    }
  }

  private async assertItemSourcesExist(
    idField: 'demand_category_id' | 'hostel_room_type_id' | 'transport_stage_id',
    ids: number[],
  ) {
    let found: { id: number }[];

    try {
      if (idField === 'hostel_room_type_id') {
        found = await this.prisma.hostel_room_types.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
      } else if (idField === 'transport_stage_id') {
        found = await this.prisma.transport_stages.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
      } else {
        found = await this.prisma.demand_categories.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
      }
    } catch (err) {
      this.logger.error('DB error during fee structure item source lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong while creating the fee structure.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (found.length !== ids.length) {
      throw new NotFoundException({
        message: 'One or more fee structure item sources were not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }
  }
}
