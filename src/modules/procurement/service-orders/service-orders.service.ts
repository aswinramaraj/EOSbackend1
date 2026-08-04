import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateServiceOrderDto } from './dto/create-service-order.dto';
import { UpdateServiceOrderDto } from './dto/update-service-order.dto';

@Injectable()
export class ServiceOrdersService {
  private readonly logger = new Logger(ServiceOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /service-orders
   *
   * Error cases:
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – proposal_id does not exist
   *  404 USER_NOT_FOUND                   – approved_by_user_id does not exist
   *  409 SERVICE_ORDER_PROPOSAL_IN_USE    – proposal_id is already used by another service order
   *  409 SERVICE_ORDER_NUMBER_EXISTS      – so_number already used by another service order
   *  500 INTERNAL_ERROR                   – unexpected failure (DB, etc.)
   */
  async create(dto: CreateServiceOrderDto) {
    await this.assertProposalExists(dto.proposal_id);
    await this.assertProposalNotAlreadyUsed(dto.proposal_id);
    await this.assertSoNumberAvailable(dto.so_number);

    if (dto.approved_by_user_id !== undefined) {
      await this.assertUserExists(dto.approved_by_user_id);
    }

    try {
      return await this.prisma.service_orders.create({
        data: {
          proposal_id: dto.proposal_id,
          so_number: dto.so_number,
          approved_by_user_id: dto.approved_by_user_id,
          approved_at: dto.approved_at,
          file_url: dto.file_url,
          sent_to_vendor_at: dto.sent_to_vendor_at,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating service order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /service-orders
   */
  async findAll() {
    try {
      return await this.prisma.service_orders.findMany({
        orderBy: { created_at: 'desc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching service orders', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /service-orders/:id
   *
   * Error cases:
   *  404 SERVICE_ORDER_NOT_FOUND – no service order with the given id
   */
  async findOne(id: number) {
    const serviceOrder = await this.findById(id);

    if (!serviceOrder) {
      throw new NotFoundException({
        message: 'Service order not found',
        errorCode: 'SERVICE_ORDER_NOT_FOUND',
      });
    }

    return serviceOrder;
  }

  /**
   * PUT/PATCH /service-orders/:id
   *
   * Error cases:
   *  404 SERVICE_ORDER_NOT_FOUND           – no service order with the given id
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND  – proposal_id does not exist
   *  404 USER_NOT_FOUND                    – approved_by_user_id does not exist
   *  409 SERVICE_ORDER_PROPOSAL_IN_USE     – proposal_id is already used by another service order
   *  409 SERVICE_ORDER_NUMBER_EXISTS       – so_number already used by another service order
   */
  async update(id: number, dto: UpdateServiceOrderDto) {
    const serviceOrder = await this.findById(id);

    if (!serviceOrder) {
      throw new NotFoundException({
        message: 'Service order not found',
        errorCode: 'SERVICE_ORDER_NOT_FOUND',
      });
    }

    if (
      dto.proposal_id !== undefined &&
      dto.proposal_id !== serviceOrder.proposal_id
    ) {
      await this.assertProposalExists(dto.proposal_id);
      await this.assertProposalNotAlreadyUsed(dto.proposal_id, id);
    }

    if (
      dto.so_number !== undefined &&
      dto.so_number !== serviceOrder.so_number
    ) {
      await this.assertSoNumberAvailable(dto.so_number, id);
    }

    if (
      dto.approved_by_user_id !== undefined &&
      dto.approved_by_user_id !== null
    ) {
      await this.assertUserExists(dto.approved_by_user_id);
    }

    try {
      return await this.prisma.service_orders.update({
        where: { id },
        data: {
          proposal_id: dto.proposal_id,
          so_number: dto.so_number,
          approved_by_user_id: dto.approved_by_user_id,
          approved_at: dto.approved_at,
          file_url: dto.file_url,
          sent_to_vendor_at: dto.sent_to_vendor_at,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating service order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /service-orders/:id
   *
   * No other table references service_orders.id, so no usage guard is
   * required before deleting.
   *
   * Error cases:
   *  404 SERVICE_ORDER_NOT_FOUND – no service order with the given id
   */
  async remove(id: number) {
    const serviceOrder = await this.findById(id);

    if (!serviceOrder) {
      throw new NotFoundException({
        message: 'Service order not found',
        errorCode: 'SERVICE_ORDER_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.service_orders.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting service order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertProposalExists(proposalId: number) {
    let proposal: unknown;

    try {
      proposal = await this.prisma.service_order_proposals.findUnique({
        where: { id: proposalId },
      });
    } catch (err) {
      this.logger.error('DB error during service order proposal lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!proposal) {
      throw new NotFoundException({
        message: 'Service order proposal not found',
        errorCode: 'SERVICE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }
  }

  private async assertProposalNotAlreadyUsed(
    proposalId: number,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.service_orders.findUnique({
        where: { proposal_id: proposalId },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during service order proposal usage check',
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
          'This proposal has already been converted into a service order',
        errorCode: 'SERVICE_ORDER_PROPOSAL_IN_USE',
      });
    }
  }

  private async assertSoNumberAvailable(soNumber: string, excludeId?: number) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.service_orders.findUnique({
        where: { so_number: soNumber },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during service order number duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'A service order with this number already exists',
        errorCode: 'SERVICE_ORDER_NUMBER_EXISTS',
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
      return await this.prisma.service_orders.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during service order lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
