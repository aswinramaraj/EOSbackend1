import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /purchase-orders
   *
   * Error cases:
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – proposal_id does not exist
   *  404 USER_NOT_FOUND                    – approved_by_user_id does not exist
   *  409 PURCHASE_ORDER_PROPOSAL_IN_USE     – proposal_id is already used by another purchase order
   *  409 PURCHASE_ORDER_NUMBER_EXISTS      – po_number already used by another purchase order
   *  500 INTERNAL_ERROR                    – unexpected failure (DB, etc.)
   */
  async create(dto: CreatePurchaseOrderDto) {
    await this.assertProposalExists(dto.proposal_id);
    await this.assertProposalNotAlreadyUsed(dto.proposal_id);
    await this.assertPoNumberAvailable(dto.po_number);

    if (dto.approved_by_user_id !== undefined) {
      await this.assertUserExists(dto.approved_by_user_id);
    }

    try {
      return await this.prisma.purchase_orders.create({
        data: {
          proposal_id: dto.proposal_id,
          po_number: dto.po_number,
          approved_by_user_id: dto.approved_by_user_id,
          approved_at: dto.approved_at,
          file_url: dto.file_url,
          sent_to_vendor_at: dto.sent_to_vendor_at,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating purchase order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /purchase-orders
   */
  async findAll() {
    try {
      return await this.prisma.purchase_orders.findMany({
        orderBy: { created_at: 'desc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching purchase orders', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /purchase-orders/:id
   *
   * Error cases:
   *  404 PURCHASE_ORDER_NOT_FOUND – no purchase order with the given id
   */
  async findOne(id: number) {
    const purchaseOrder = await this.findById(id);

    if (!purchaseOrder) {
      throw new NotFoundException({
        message: 'Purchase order not found',
        errorCode: 'PURCHASE_ORDER_NOT_FOUND',
      });
    }

    return purchaseOrder;
  }

  /**
   * PUT/PATCH /purchase-orders/:id
   *
   * Error cases:
   *  404 PURCHASE_ORDER_NOT_FOUND           – no purchase order with the given id
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND  – proposal_id does not exist
   *  404 USER_NOT_FOUND                     – approved_by_user_id does not exist
   *  409 PURCHASE_ORDER_PROPOSAL_IN_USE     – proposal_id is already used by another purchase order
   *  409 PURCHASE_ORDER_NUMBER_EXISTS       – po_number already used by another purchase order
   */
  async update(id: number, dto: UpdatePurchaseOrderDto) {
    const purchaseOrder = await this.findById(id);

    if (!purchaseOrder) {
      throw new NotFoundException({
        message: 'Purchase order not found',
        errorCode: 'PURCHASE_ORDER_NOT_FOUND',
      });
    }

    if (
      dto.proposal_id !== undefined &&
      dto.proposal_id !== purchaseOrder.proposal_id
    ) {
      await this.assertProposalExists(dto.proposal_id);
      await this.assertProposalNotAlreadyUsed(dto.proposal_id, id);
    }

    if (
      dto.po_number !== undefined &&
      dto.po_number !== purchaseOrder.po_number
    ) {
      await this.assertPoNumberAvailable(dto.po_number, id);
    }

    if (
      dto.approved_by_user_id !== undefined &&
      dto.approved_by_user_id !== null
    ) {
      await this.assertUserExists(dto.approved_by_user_id);
    }

    try {
      return await this.prisma.purchase_orders.update({
        where: { id },
        data: {
          proposal_id: dto.proposal_id,
          po_number: dto.po_number,
          approved_by_user_id: dto.approved_by_user_id,
          approved_at: dto.approved_at,
          file_url: dto.file_url,
          sent_to_vendor_at: dto.sent_to_vendor_at,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating purchase order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /purchase-orders/:id
   *
   * Error cases:
   *  404 PURCHASE_ORDER_NOT_FOUND – no purchase order with the given id
   *  409 PURCHASE_ORDER_IN_USE    – purchase order is referenced by grn
   */
  async remove(id: number) {
    const purchaseOrder = await this.findById(id);

    if (!purchaseOrder) {
      throw new NotFoundException({
        message: 'Purchase order not found',
        errorCode: 'PURCHASE_ORDER_NOT_FOUND',
      });
    }

    let usageCount: number;

    try {
      usageCount = await this.prisma.grn.count({
        where: { purchase_order_id: id },
      });
    } catch (err) {
      this.logger.error('DB error while checking purchase order usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCount > 0) {
      throw new ConflictException({
        message: 'This purchase order is in use and cannot be deleted',
        errorCode: 'PURCHASE_ORDER_IN_USE',
      });
    }

    try {
      return await this.prisma.purchase_orders.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting purchase order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertProposalExists(proposalId: number) {
    let proposal: unknown;

    try {
      proposal = await this.prisma.purchase_order_proposals.findUnique({
        where: { id: proposalId },
      });
    } catch (err) {
      this.logger.error('DB error during purchase order proposal lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!proposal) {
      throw new NotFoundException({
        message: 'Purchase order proposal not found',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }
  }

  private async assertProposalNotAlreadyUsed(
    proposalId: number,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.purchase_orders.findUnique({
        where: { proposal_id: proposalId },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during purchase order proposal usage check',
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
          'This proposal has already been converted into a purchase order',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_IN_USE',
      });
    }
  }

  private async assertPoNumberAvailable(poNumber: string, excludeId?: number) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.purchase_orders.findUnique({
        where: { po_number: poNumber },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during purchase order number duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'A purchase order with this number already exists',
        errorCode: 'PURCHASE_ORDER_NUMBER_EXISTS',
      });
    }
  }

  private async assertUserExists(userId: number) {
    let user: unknown;

    try {
      user = await this.prisma.users.findUnique({ where: { id: userId } });
    } catch (err) {
      this.logger.error('DB error during user lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!user) {
      throw new NotFoundException({
        message: 'User not found',
        errorCode: 'USER_NOT_FOUND',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.purchase_orders.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during purchase order lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
