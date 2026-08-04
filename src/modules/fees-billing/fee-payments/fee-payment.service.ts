import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { CreateFeePaymentDto } from './dto/create-fee-payment.dto';
import { UpdateFeePaymentDto } from './dto/update-fee-payment.dto';

@Injectable()
export class FeePaymentService {
  private readonly logger = new Logger(FeePaymentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /fee-payments
   */
  async findAll() {
    try {
      return await this.prisma.fee_payments.findMany({
        orderBy: [{ student_fee_demand_mapping_id: 'asc' }, { id: 'asc' }],
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee payments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /fee-payments/:id
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND – no payment with the given id
   */
  async findOne(id: number) {
    const payment = await this.findById(id);

    if (!payment) {
      throw new NotFoundException({
        message: 'Fee payment not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    return payment;
  }

  /**
   * GET /student-fee-demand-mappings/:id/payments
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async findAllForDemandMapping(demandMappingId: number) {
    await this.assertDemandMappingExists(demandMappingId);

    try {
      return await this.prisma.fee_payments.findMany({
        where: { student_fee_demand_mapping_id: demandMappingId },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee payments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /student-fee-demand-mappings/:id/payments
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND  – no demand mapping with the given id
   *  404 USER_NOT_FOUND                – collected_by_user_id does not exist
   *  409 FEE_PAYMENT_RECEIPT_EXISTS    – receipt_no already used by another payment
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT    – amount_paid would exceed the demand's total_amount
   */
  async create(demandMappingId: number, dto: CreateFeePaymentDto) {
    const mapping = await this.assertDemandMappingExists(demandMappingId);

    if (dto.collected_by_user_id !== undefined) {
      await this.assertUserExists(dto.collected_by_user_id);
    }

    await this.assertReceiptNoAvailable(dto.receipt_no);
    await this.assertWithinDueAmount(
      demandMappingId,
      mapping.total_amount,
      dto.amount_paid,
    );

    try {
      return await this.prisma.fee_payments.create({
        data: {
          student_fee_demand_mapping_id: demandMappingId,
          amount_paid: dto.amount_paid,
          receipt_no: dto.receipt_no,
          payment_mode: dto.payment_mode,
          is_partial: dto.is_partial,
          collected_by_user_id: dto.collected_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating fee payment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PUT/PATCH /fee-payments/:id
   *
   * student_fee_demand_mapping_id is immutable — the payment remains attached
   * to its original demand mapping.
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND        – no payment with the given id
   *  404 USER_NOT_FOUND                – collected_by_user_id does not exist
   *  409 FEE_PAYMENT_RECEIPT_EXISTS    – receipt_no already used by another payment
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT    – amount_paid would exceed the demand's total_amount
   */
  async update(id: number, dto: UpdateFeePaymentDto) {
    const payment = await this.findById(id);

    if (!payment) {
      throw new NotFoundException({
        message: 'Fee payment not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    if (dto.collected_by_user_id !== undefined) {
      await this.assertUserExists(dto.collected_by_user_id);
    }

    if (dto.receipt_no !== undefined && dto.receipt_no !== payment.receipt_no) {
      await this.assertReceiptNoAvailable(dto.receipt_no, id);
    }

    if (dto.amount_paid !== undefined) {
      const mapping = await this.assertDemandMappingExists(
        payment.student_fee_demand_mapping_id,
      );
      await this.assertWithinDueAmount(
        payment.student_fee_demand_mapping_id,
        mapping.total_amount,
        dto.amount_paid,
        id,
      );
    }

    try {
      return await this.prisma.fee_payments.update({
        where: { id },
        data: {
          amount_paid: dto.amount_paid,
          receipt_no: dto.receipt_no,
          payment_mode: dto.payment_mode,
          is_partial: dto.is_partial,
          collected_by_user_id: dto.collected_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating fee payment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /fee-payments/:id
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND – no payment with the given id
   */
  async remove(id: number) {
    const payment = await this.findById(id);

    if (!payment) {
      throw new NotFoundException({
        message: 'Fee payment not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.fee_payments.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting fee payment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertDemandMappingExists(demandMappingId: number) {
    let mapping: { total_amount: Prisma.Decimal } | null;

    try {
      mapping = await this.prisma.student_fee_demand_mapping.findUnique({
        where: { id: demandMappingId },
        select: { total_amount: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during student fee demand mapping lookup',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    return mapping;
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

  private async assertReceiptNoAvailable(
    receiptNo: string,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.fee_payments.findUnique({
        where: { receipt_no: receiptNo },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during fee payment receipt duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'A fee payment with this receipt number already exists',
        errorCode: 'FEE_PAYMENT_RECEIPT_EXISTS',
      });
    }
  }

  /**
   * Application-level financial integrity rule (not encoded in schema.prisma):
   * the sum of all payments recorded against a student's fee demand must never
   * exceed that demand's total_amount.
   */
  private async assertWithinDueAmount(
    demandMappingId: number,
    totalAmount: Prisma.Decimal,
    incomingAmount: number,
    excludeId?: number,
  ) {
    let collectedSoFar: Prisma.Decimal;

    try {
      const result = await this.prisma.fee_payments.aggregate({
        where: {
          student_fee_demand_mapping_id: demandMappingId,
          ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        },
        _sum: { amount_paid: true },
      });

      collectedSoFar = result._sum.amount_paid ?? new Prisma.Decimal(0);
    } catch (err) {
      this.logger.error('DB error while summing fee payments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const projectedTotal = collectedSoFar.plus(incomingAmount);

    if (projectedTotal.greaterThan(totalAmount)) {
      throw new UnprocessableEntityException({
        message:
          'Payment amount would exceed the total amount due for this fee demand',
        errorCode: 'PAYMENT_EXCEEDS_DUE_AMOUNT',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.fee_payments.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during fee payment lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
