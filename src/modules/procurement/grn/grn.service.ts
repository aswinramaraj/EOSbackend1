import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateGrnDto } from './dto/create-grn.dto';
import { UpdateGrnDto } from './dto/update-grn.dto';

@Injectable()
export class GrnService {
  private readonly logger = new Logger(GrnService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /grn
   *
   * Error cases:
   *  404 PURCHASE_ORDER_NOT_FOUND – purchase_order_id does not exist
   *  404 VENUE_NOT_FOUND          – issued_to_venue_id does not exist
   *  404 USER_NOT_FOUND           – recorded_by_user_id does not exist
   *  500 INTERNAL_ERROR           – unexpected failure (DB, etc.)
   */
  async create(dto: CreateGrnDto) {
    await this.assertPurchaseOrderExists(dto.purchase_order_id);

    if (dto.issued_to_venue_id !== undefined) {
      await this.assertVenueExists(dto.issued_to_venue_id);
    }

    if (dto.recorded_by_user_id !== undefined) {
      await this.assertUserExists(dto.recorded_by_user_id);
    }

    try {
      return await this.prisma.grn.create({
        data: {
          purchase_order_id: dto.purchase_order_id,
          quantity_received: dto.quantity_received,
          received_date: dto.received_date,
          issued_to_venue_id: dto.issued_to_venue_id,
          issued_date: dto.issued_date,
          recorded_by_user_id: dto.recorded_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating GRN', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /grn
   */
  async findAll() {
    try {
      return await this.prisma.grn.findMany({
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching GRNs', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /grn/:id
   *
   * Error cases:
   *  404 GRN_NOT_FOUND – no GRN with the given id
   */
  async findOne(id: number) {
    const grn = await this.findById(id);

    if (!grn) {
      throw new NotFoundException({
        message: 'GRN not found',
        errorCode: 'GRN_NOT_FOUND',
      });
    }

    return grn;
  }

  /**
   * PUT/PATCH /grn/:id
   *
   * Error cases:
   *  404 GRN_NOT_FOUND            – no GRN with the given id
   *  404 PURCHASE_ORDER_NOT_FOUND – purchase_order_id does not exist
   *  404 VENUE_NOT_FOUND          – issued_to_venue_id does not exist
   *  404 USER_NOT_FOUND           – recorded_by_user_id does not exist
   */
  async update(id: number, dto: UpdateGrnDto) {
    const grn = await this.findById(id);

    if (!grn) {
      throw new NotFoundException({
        message: 'GRN not found',
        errorCode: 'GRN_NOT_FOUND',
      });
    }

    if (
      dto.purchase_order_id !== undefined &&
      dto.purchase_order_id !== grn.purchase_order_id
    ) {
      await this.assertPurchaseOrderExists(dto.purchase_order_id);
    }

    if (
      dto.issued_to_venue_id !== undefined &&
      dto.issued_to_venue_id !== null
    ) {
      await this.assertVenueExists(dto.issued_to_venue_id);
    }

    if (
      dto.recorded_by_user_id !== undefined &&
      dto.recorded_by_user_id !== null
    ) {
      await this.assertUserExists(dto.recorded_by_user_id);
    }

    try {
      return await this.prisma.grn.update({
        where: { id },
        data: {
          purchase_order_id: dto.purchase_order_id,
          quantity_received: dto.quantity_received,
          received_date: dto.received_date,
          issued_to_venue_id: dto.issued_to_venue_id,
          issued_date: dto.issued_date,
          recorded_by_user_id: dto.recorded_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating GRN', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /grn/:id
   *
   * No other table references grn.id, so no usage guard is required before
   * deleting.
   *
   * Error cases:
   *  404 GRN_NOT_FOUND – no GRN with the given id
   */
  async remove(id: number) {
    const grn = await this.findById(id);

    if (!grn) {
      throw new NotFoundException({
        message: 'GRN not found',
        errorCode: 'GRN_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.grn.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting GRN', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertPurchaseOrderExists(purchaseOrderId: number) {
    let purchaseOrder: unknown;

    try {
      purchaseOrder = await this.prisma.purchase_orders.findUnique({
        where: { id: purchaseOrderId },
      });
    } catch (err) {
      this.logger.error('DB error during purchase order lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!purchaseOrder) {
      throw new NotFoundException({
        message: 'Purchase order not found',
        errorCode: 'PURCHASE_ORDER_NOT_FOUND',
      });
    }
  }

  private async assertVenueExists(venueId: number) {
    let venue: unknown;

    try {
      venue = await this.prisma.venues.findUnique({ where: { id: venueId } });
    } catch (err) {
      this.logger.error('DB error during venue lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!venue) {
      throw new NotFoundException({
        message: 'Venue not found',
        errorCode: 'VENUE_NOT_FOUND',
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
      return await this.prisma.grn.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during GRN lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
