import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { proposal_status_enum } from '../../../../generated/prisma/client';
import { CreatePurchaseOrderProposalDto } from './dto/create-purchase-order-proposal.dto';
import { UpdatePurchaseOrderProposalDto } from './dto/update-purchase-order-proposal.dto';
import { FinanceReviewDto } from './dto/finance-review.dto';
import { HodReviewDto } from './dto/hod-review.dto';

@Injectable()
export class PurchaseOrderProposalsService {
  private readonly logger = new Logger(PurchaseOrderProposalsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /purchase-order-proposals
   *
   * status is never accepted from the client — Prisma applies the schema
   * default (`pending`) automatically.
   *
   * Error cases:
   *  404 PURCHASE_INDENT_NOT_FOUND – indent_id does not exist
   *  404 VENDOR_NOT_FOUND          – vendor_id does not exist
   *  500 INTERNAL_ERROR            – unexpected failure (DB, etc.)
   */
  async create(dto: CreatePurchaseOrderProposalDto) {
    await this.assertIndentExists(dto.indent_id);

    if (dto.vendor_id !== undefined) {
      await this.assertVendorExists(dto.vendor_id);
    }

    try {
      return await this.prisma.purchase_order_proposals.create({
        data: {
          indent_id: dto.indent_id,
          vendor_id: dto.vendor_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating purchase order proposal', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /purchase-order-proposals
   */
  async findAll() {
    try {
      return await this.prisma.purchase_order_proposals.findMany({
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error(
        'DB error while fetching purchase order proposals',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /purchase-order-proposals/:id
   *
   * Error cases:
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   */
  async findOne(id: number) {
    const proposal = await this.findById(id);

    if (!proposal) {
      throw new NotFoundException({
        message: 'Purchase order proposal not found',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }

    return proposal;
  }

  /**
   * PUT/PATCH /purchase-order-proposals/:id
   *
   * Only vendor_id may be updated here. This endpoint never touches status
   * or either reviewer/timestamp pair — workflow state is only ever changed
   * by the finance-review and hod-review endpoints.
   *
   * Error cases:
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  404 VENDOR_NOT_FOUND                  – vendor_id does not exist
   */
  async update(id: number, dto: UpdatePurchaseOrderProposalDto) {
    const proposal = await this.findById(id);

    if (!proposal) {
      throw new NotFoundException({
        message: 'Purchase order proposal not found',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }

    if (dto.vendor_id !== undefined && dto.vendor_id !== null) {
      await this.assertVendorExists(dto.vendor_id);
    }

    try {
      return await this.prisma.purchase_order_proposals.update({
        where: { id },
        data: {
          vendor_id: dto.vendor_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating purchase order proposal', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /purchase-order-proposals/:id/finance-review
   *
   * Records the finance reviewer's decision. Only legal when the proposal is
   * currently `pending`. finance_reviewed_at is always server-set.
   *
   * Error cases:
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  404 USER_NOT_FOUND                    – finance_reviewed_by does not exist
   *  422 INVALID_WORKFLOW_STATE            – proposal is not currently `pending`
   */
  async financeReview(id: number, dto: FinanceReviewDto) {
    const proposal = await this.findById(id);

    if (!proposal) {
      throw new NotFoundException({
        message: 'Purchase order proposal not found',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }

    await this.assertUserExists(dto.finance_reviewed_by);

    if (proposal.status !== proposal_status_enum.pending) {
      throw new UnprocessableEntityException({
        message:
          'Finance review can only be recorded while the proposal is pending',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    try {
      return await this.prisma.purchase_order_proposals.update({
        where: { id },
        data: {
          finance_reviewed_by: dto.finance_reviewed_by,
          finance_reviewed_at: new Date(),
          status: dto.status,
        },
      });
    } catch (err) {
      this.logger.error('DB error while recording finance review', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /purchase-order-proposals/:id/hod-review
   *
   * Records the HoD reviewer's decision. Only legal when the proposal is
   * currently `finance_approved`. hod_reviewed_at is always server-set.
   *
   * Error cases:
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  404 USER_NOT_FOUND                    – hod_reviewed_by does not exist
   *  422 INVALID_WORKFLOW_STATE            – proposal is not currently `finance_approved`
   */
  async hodReview(id: number, dto: HodReviewDto) {
    const proposal = await this.findById(id);

    if (!proposal) {
      throw new NotFoundException({
        message: 'Purchase order proposal not found',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }

    await this.assertUserExists(dto.hod_reviewed_by);

    if (proposal.status !== proposal_status_enum.finance_approved) {
      throw new UnprocessableEntityException({
        message:
          'HoD review can only be recorded once the proposal is finance approved',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    try {
      return await this.prisma.purchase_order_proposals.update({
        where: { id },
        data: {
          hod_reviewed_by: dto.hod_reviewed_by,
          hod_reviewed_at: new Date(),
          status: dto.status,
        },
      });
    } catch (err) {
      this.logger.error('DB error while recording HoD review', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /purchase-order-proposals/:id
   *
   * Error cases:
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – no proposal with the given id
   *  409 PROPOSAL_IN_USE                   – proposal already converted into a purchase order
   */
  async remove(id: number) {
    const proposal = await this.findById(id);

    if (!proposal) {
      throw new NotFoundException({
        message: 'Purchase order proposal not found',
        errorCode: 'PURCHASE_ORDER_PROPOSAL_NOT_FOUND',
      });
    }

    let purchaseOrderCount: number;

    try {
      purchaseOrderCount = await this.prisma.purchase_orders.count({
        where: { proposal_id: id },
      });
    } catch (err) {
      this.logger.error(
        'DB error while checking purchase order proposal usage',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (purchaseOrderCount > 0) {
      throw new ConflictException({
        message:
          'This proposal has already been converted into a purchase order and cannot be deleted',
        errorCode: 'PROPOSAL_IN_USE',
      });
    }

    try {
      return await this.prisma.purchase_order_proposals.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting purchase order proposal', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertIndentExists(indentId: number) {
    let indent: unknown;

    try {
      indent = await this.prisma.purchase_indents.findUnique({
        where: { id: indentId },
      });
    } catch (err) {
      this.logger.error('DB error during purchase indent lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!indent) {
      throw new NotFoundException({
        message: 'Purchase indent not found',
        errorCode: 'PURCHASE_INDENT_NOT_FOUND',
      });
    }
  }

  private async assertVendorExists(vendorId: number) {
    let vendor: unknown;

    try {
      vendor = await this.prisma.vendors.findUnique({
        where: { id: vendorId },
      });
    } catch (err) {
      this.logger.error('DB error during vendor lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!vendor) {
      throw new NotFoundException({
        message: 'Vendor not found',
        errorCode: 'VENDOR_NOT_FOUND',
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
      return await this.prisma.purchase_order_proposals.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during purchase order proposal lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
