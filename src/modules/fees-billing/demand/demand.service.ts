import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateDemandCategoryDto } from './dto/create-demand-category.dto';
import { UpdateDemandCategoryDto } from './dto/update-demand-category.dto';

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * POST /demand-categories
   *
   * Error cases:
   *  409 DEMAND_CATEGORY_EXISTS – a demand category with the same name already exists
   *  500 INTERNAL_ERROR         – unexpected failure (DB, etc.)
   */
  async create(dto: CreateDemandCategoryDto, performedByUserId: number) {
    const existing = await this.findByName(dto.name);

    if (existing) {
      throw new ConflictException({
        message: 'A demand category with this name already exists',
        errorCode: 'DEMAND_CATEGORY_EXISTS',
      });
    }

    try {
      const created = await this.prisma.demand_categories.create({
        data: { name: dto.name },
      });

      await this.auditLog.record({
        entity_type: 'demand_category',
        entity_id: created.id,
        action: 'created',
        performed_by_user_id: performedByUserId,
        new_value: { name: created.name },
      });

      return created;
    } catch (err) {
      this.logger.error('DB error while creating demand category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /demand-categories
   */
  async findAll() {
    try {
      return await this.prisma.demand_categories.findMany({
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching demand categories', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /demand-categories/:id
   *
   * Error cases:
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   */
  async findOne(id: number) {
    const category = await this.findById(id);

    if (!category) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }

    return category;
  }

  /**
   * PUT /demand-categories/:id
   *
   * Error cases:
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   *  409 DEMAND_CATEGORY_EXISTS    – another category already uses this name
   */
  async update(
    id: number,
    dto: UpdateDemandCategoryDto,
    performedByUserId: number,
  ) {
    const category = await this.findById(id);

    if (!category) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByName(dto.name);

      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A demand category with this name already exists',
          errorCode: 'DEMAND_CATEGORY_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.demand_categories.update({
        where: { id },
        data: { name: dto.name },
      });

      await this.auditLog.record({
        entity_type: 'demand_category',
        entity_id: updated.id,
        action: 'updated',
        performed_by_user_id: performedByUserId,
        old_value: { name: category.name },
        new_value: { name: updated.name },
      });

      return updated;
    } catch (err) {
      this.logger.error('DB error while updating demand category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /demand-categories/:id
   *
   * Error cases:
   *  404 DEMAND_CATEGORY_NOT_FOUND      – no category with the given id
   *  409 DEMAND_CATEGORY_IN_USE         – category is referenced by fee_structure_items
   */
  async remove(id: number, performedByUserId: number) {
    const category = await this.findById(id);

    if (!category) {
      throw new NotFoundException({
        message: 'Demand category not found',
        errorCode: 'DEMAND_CATEGORY_NOT_FOUND',
      });
    }

    let usageCount: number;

    try {
      usageCount = await this.prisma.fee_structure_items.count({
        where: { demand_category_id: id },
      });
    } catch (err) {
      this.logger.error('DB error while checking demand category usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCount > 0) {
      throw new ConflictException({
        message: 'This demand category is in use and cannot be deleted',
        errorCode: 'DEMAND_CATEGORY_IN_USE',
      });
    }

    try {
      const deleted = await this.prisma.demand_categories.delete({
        where: { id },
      });

      await this.auditLog.record({
        entity_type: 'demand_category',
        entity_id: deleted.id,
        action: 'deleted',
        performed_by_user_id: performedByUserId,
        old_value: { name: deleted.name },
      });

      return deleted;
    } catch (err) {
      this.logger.error('DB error while deleting demand category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findByName(name: string) {
    try {
      return await this.prisma.demand_categories.findUnique({
        where: { name },
      });
    } catch (err) {
      this.logger.error('DB error during demand category duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.demand_categories.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during demand category lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /demand-categories/summary — real institution-wide raised/
   * collected/students-count per demand category, for the Billing
   * Portal's "Demand" screen. Not a pre-existing endpoint (only plain
   * {id,name} CRUD existed) — added additively, computed from real
   * `fee_structure_items`/`student_fee_demand_mapping`/`fee_payments`
   * joins, no new table/column, no fake numbers.
   *
   * Two separate grouped queries (raised+students, then collected) rather
   * than one join, because joining fee_payments AND
   * student_fee_demand_mapping in the same query fans out and
   * double-counts collected amounts when a fee_structure has more than
   * one enrolled student.
   */
  async summary() {
    try {
      const raisedRows: { category_id: number; category_name: string; students: bigint; raised: string; applies_hostel: boolean; applies_transport: boolean }[] =
        await this.prisma.$queryRaw`
          SELECT dc.id AS category_id, dc.name AS category_name,
            COUNT(DISTINCT sfdm.student_id) AS students,
            COALESCE(SUM(fsi.amount), 0)::text AS raised,
            bool_or(fsi.hostel_room_type_id IS NOT NULL) AS applies_hostel,
            bool_or(fsi.transport_stage_id IS NOT NULL) AS applies_transport
          FROM demand_categories dc
          LEFT JOIN fee_structure_items fsi ON fsi.demand_category_id = dc.id
          LEFT JOIN student_fee_demand_mapping sfdm ON sfdm.fee_structure_id = fsi.fee_structure_id
          GROUP BY dc.id, dc.name
          ORDER BY dc.name
        `;

      const collectedRows: { category_id: number; collected: string }[] =
        await this.prisma.$queryRaw`
          SELECT dc.id AS category_id, COALESCE(SUM(fp.amount_paid), 0)::text AS collected
          FROM demand_categories dc
          LEFT JOIN fee_structure_items fsi ON fsi.demand_category_id = dc.id
          LEFT JOIN fee_payments fp ON fp.fee_structure_item_id = fsi.id
          GROUP BY dc.id
        `;
      const collectedByCategory = new Map(collectedRows.map((r) => [r.category_id, r.collected]));

      return raisedRows.map((r) => {
        const raised = Number(r.raised);
        const collected = Number(collectedByCategory.get(r.category_id) ?? '0');
        return {
          category_id: r.category_id,
          category_name: r.category_name,
          applies_to: r.applies_hostel ? 'Hostel residents' : r.applies_transport ? 'Transport users' : 'All programmes',
          students: Number(r.students),
          raised: raised.toFixed(2),
          collected: collected.toFixed(2),
          balance: (raised - collected).toFixed(2),
        };
      });
    } catch (err) {
      this.logger.error('DB error while computing demand category summary', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
