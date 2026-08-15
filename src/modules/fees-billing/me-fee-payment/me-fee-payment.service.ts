import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import {
  CreateFeePaymentOrderDto,
  FeePaymentItemDto,
} from './dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from './dto/verify-fee-payment.dto';

/**
 * Razorpay's own `method` values ('card' | 'upi' | 'netbanking' | 'wallet' |
 * 'emi' | ...) don't line up 1:1 with payment_mode_enum (cash | card | upi |
 * dd | netbanking) — only these three ever map cleanly. Anything else
 * (wallet/emi/paylater) leaves payment_mode null rather than guessing,
 * since fee_payments.payment_mode is nullable.
 */
const RAZORPAY_METHOD_TO_PAYMENT_MODE: Record<
  string,
  'card' | 'upi' | 'netbanking'
> = {
  card: 'card',
  upi: 'upi',
  netbanking: 'netbanking',
};

@Injectable()
export class MeFeePaymentService {
  private readonly logger = new Logger(MeFeePaymentService.name);
  private razorpay: Razorpay | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // Mirrors WalletService.getRazorpay() — same env vars, same lazy-init,
  // same "not configured" error shape. Not extracted into a shared helper
  // since that would mean touching wallet.service.ts for a two-module reuse.
  private getRazorpay(): Razorpay {
    if (!this.razorpay) {
      const key_id = process.env.RAZORPAY_KEY_ID;
      const key_secret = process.env.RAZORPAY_KEY_SECRET;
      if (!key_id || !key_secret) {
        throw new InternalServerErrorException({
          message: 'Razorpay is not configured',
          errorCode: 'RAZORPAY_NOT_CONFIGURED',
        });
      }
      this.razorpay = new Razorpay({ key_id, key_secret });
    }
    return this.razorpay;
  }

  private async resolveStudentId(userId: number): Promise<number> {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return student.id;
  }

  private async loadDemandDue(demandId: number, studentId: number) {
    const demand = await this.prisma.student_fee_demand_mapping.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        student_id: true,
        total_amount: true,
        fee_payments: { select: { amount_paid: true } },
      },
    });
    if (!demand || demand.student_id !== studentId) {
      throw new NotFoundException({
        message: 'Fee demand not found',
        errorCode: 'DEMAND_NOT_FOUND',
      });
    }

    const paid = demand.fee_payments.reduce(
      (sum, p) => sum.plus(p.amount_paid),
      new Prisma.Decimal(0),
    );
    const due = new Prisma.Decimal(demand.total_amount).minus(paid);
    return { demand, paid, due };
  }

  /**
   * Same shape as loadDemandDue, but scoped to one fee_structure_item within
   * the demand's fee structure — mirrors FeePaymentService's admin-side
   * per-item outstanding check (fee-payment.service.ts, ~line 728-740):
   * alreadyPaid is always scoped by BOTH student_fee_demand_mapping_id AND
   * fee_structure_item_id, never by item id alone (the same
   * fee_structure_items row is shared by every student mapped to that
   * structure).
   */
  private async loadItemDue(
    demandId: number,
    itemId: number,
    studentId: number,
  ) {
    const demand = await this.prisma.student_fee_demand_mapping.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        student_id: true,
        fee_structure_id: true,
        fee_payments: {
          select: { amount_paid: true, fee_structure_item_id: true },
        },
      },
    });
    if (!demand || demand.student_id !== studentId) {
      throw new NotFoundException({
        message: 'Fee demand not found',
        errorCode: 'DEMAND_NOT_FOUND',
      });
    }

    const item = await this.prisma.fee_structure_items.findUnique({
      where: { id: itemId },
      select: { id: true, amount: true, fee_structure_id: true },
    });
    if (!item || item.fee_structure_id !== demand.fee_structure_id) {
      throw new NotFoundException({
        message: 'This fee item does not belong to the selected fee demand',
        errorCode: 'FEE_STRUCTURE_ITEM_MISMATCH',
      });
    }

    const paid = demand.fee_payments
      .filter((p) => p.fee_structure_item_id === itemId)
      .reduce((sum, p) => sum.plus(p.amount_paid), new Prisma.Decimal(0));
    const due = new Prisma.Decimal(item.amount).minus(paid);
    return { item, paid, due };
  }

  /**
   * POST /me/fees/pay/order — creates a single Razorpay order covering one
   * or more of the caller's own fee demands (a "cart"), each capped at its
   * own outstanding due. The demand_ids/amounts and student_id are embedded
   * in the order's `notes` (as parallel comma-joined strings, not JSON —
   * Razorpay caps each notes value at 256 characters, and a handful of
   * small integers joined with commas comfortably fits where a JSON blob of
   * objects might not) so verifyPayment() can re-derive them from Razorpay
   * itself rather than trusting the client a second time. There is no local
   * "pending payment" table to stash this in (unlike wallet_transactions,
   * fee_payments has no razorpay_order_id column and no pending/staging
   * state), so Razorpay's own order record is the source of truth for this
   * student/cart pairing.
   */
  async createOrder(userId: number, dto: CreateFeePaymentOrderDto) {
    const studentId = await this.resolveStudentId(userId);

    const demandIds = dto.items.map((item) => item.demand_id);
    // A cart entry is identified by (demand_id, fee_structure_item_id) —
    // not demand_id alone — so two different items of the same demand can
    // be paid together in one checkout. Two whole-demand entries (no item
    // id) for the same demand_id would double-count it, so that pair is
    // still rejected: cartKey collapses "no item" to a shared sentinel.
    const cartKeys = dto.items.map(
      (item) => `${item.demand_id}:${item.fee_structure_item_id ?? 'whole'}`,
    );
    if (new Set(cartKeys).size !== cartKeys.length) {
      throw new BadRequestException({
        message: 'Duplicate fee demand/item in the same payment',
        errorCode: 'DUPLICATE_DEMAND_IN_CART',
      });
    }

    for (const item of dto.items) {
      if (item.fee_structure_item_id !== undefined) {
        const { due } = await this.loadItemDue(
          item.demand_id,
          item.fee_structure_item_id,
          studentId,
        );
        if (due.lessThanOrEqualTo(0)) {
          throw new BadRequestException({
            message: `This fee item for demand ${item.demand_id} has already been fully paid`,
            errorCode: 'ITEM_ALREADY_SETTLED',
          });
        }
        if (new Prisma.Decimal(item.amount).greaterThan(due)) {
          throw new BadRequestException({
            message: `Amount exceeds the outstanding due for this fee item`,
            errorCode: 'AMOUNT_EXCEEDS_DUE',
          });
        }
        continue;
      }
      const { due } = await this.loadDemandDue(item.demand_id, studentId);
      if (due.lessThanOrEqualTo(0)) {
        throw new BadRequestException({
          message: `Fee demand ${item.demand_id} has already been fully paid`,
          errorCode: 'DEMAND_ALREADY_SETTLED',
        });
      }
      if (new Prisma.Decimal(item.amount).greaterThan(due)) {
        throw new BadRequestException({
          message: `Amount exceeds the outstanding due for fee demand ${item.demand_id}`,
          errorCode: 'AMOUNT_EXCEEDS_DUE',
        });
      }
    }

    const totalAmount = dto.items.reduce((sum, item) => sum + item.amount, 0);

    const razorpay = this.getRazorpay();
    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `fee-${studentId}-${Date.now()}`,
      notes: {
        student_id: studentId,
        demand_ids: demandIds.join(','),
        amounts: dto.items.map((item) => item.amount).join(','),
        // Parallel array to demand_ids/amounts — an empty slot means "pay
        // the whole demand", matching the DTO's optional field exactly.
        // Kept as its own notes key (rather than folding into demand_ids)
        // so an in-flight order created before this field existed still
        // parses cleanly on verify (see parseCartFromNotes's fallback).
        fee_structure_item_ids: dto.items
          .map((item) => item.fee_structure_item_id ?? '')
          .join(','),
      },
    });

    return {
      order_id: order.id,
      amount: totalAmount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  private parseCartFromNotes(
    notes: Record<string, string>,
  ): FeePaymentItemDto[] {
    const demandIds = (notes.demand_ids ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    const amounts = (notes.amounts ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    if (
      demandIds.length === 0 ||
      demandIds.length !== amounts.length ||
      demandIds.some(Number.isNaN) ||
      amounts.some(Number.isNaN)
    ) {
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    // fee_structure_item_ids is a positional parallel array where an empty
    // slot means "pay the whole demand" — it must NOT be filtered the way
    // demand_ids/amounts are above (filtering would shift later entries out
    // of alignment). Missing entirely (an order created before this field
    // existed) falls back to every slot being empty, i.e. all whole-demand.
    const itemIdsRaw = notes.fee_structure_item_ids;
    const itemIds =
      itemIdsRaw !== undefined
        ? itemIdsRaw.split(',').map((v) => (v === '' ? undefined : Number(v)))
        : demandIds.map(() => undefined);
    if (
      itemIds.length !== demandIds.length ||
      itemIds.some((v) => v !== undefined && Number.isNaN(v))
    ) {
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return demandIds.map((demand_id, i) => ({
      demand_id,
      amount: amounts[i],
      fee_structure_item_id: itemIds[i],
    }));
  }

  /**
   * POST /me/fees/pay/verify — recomputes the HMAC-SHA256 signature
   * server-side before recording anything (same pattern as
   * WalletService.verifyTopup). The cart (demand_ids/amounts), student_id,
   * and authoritative total are then read back from the verified Razorpay
   * order itself (never from client-supplied fields), so a client cannot
   * claim a different cart or a different amount than what Razorpay
   * actually processed. One `fee_payments` row is written per cart item.
   */
  async verifyPayment(userId: number, dto: VerifyFeePaymentDto) {
    const studentId = await this.resolveStudentId(userId);

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new InternalServerErrorException({
        message: 'Razorpay is not configured',
        errorCode: 'RAZORPAY_NOT_CONFIGURED',
      });
    }
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');
    if (expectedSignature !== dto.razorpay_signature) {
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    const razorpay = this.getRazorpay();
    const order = await razorpay.orders.fetch(dto.razorpay_order_id);

    const noteStudentId = Number(order.notes?.student_id);
    if (noteStudentId !== studentId) {
      throw new ForbiddenException({
        message: 'This payment order does not belong to you',
        errorCode: 'ORDER_NOT_YOURS',
      });
    }
    const cart = this.parseCartFromNotes(order.notes as Record<string, string>);

    const cartTotalPaise = Math.round(
      cart.reduce((sum, item) => sum + item.amount, 0) * 100,
    );
    if (cartTotalPaise !== Number(order.amount)) {
      // The order's own notes (which we set at creation) disagree with its own
      // amount (which Razorpay set) — this should never happen; refuse rather
      // than guess how to split the charge across demands.
      this.logger.error(
        `Cart/amount mismatch for order ${order.id}: notes sum to ${cartTotalPaise}, order.amount is ${order.amount}`,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    let paymentMode: 'card' | 'upi' | 'netbanking' | undefined;
    try {
      const paymentDetails = await razorpay.payments.fetch(
        dto.razorpay_payment_id,
      );
      paymentMode = RAZORPAY_METHOD_TO_PAYMENT_MODE[paymentDetails.method];
    } catch (err) {
      this.logger.warn(
        `Could not fetch Razorpay payment method for ${dto.razorpay_payment_id}`,
        err,
      );
    }

    const payments: Awaited<
      ReturnType<typeof this.recordSingleDemandPayment>
    >[] = [];
    for (const item of cart) {
      payments.push(
        await this.recordSingleDemandPayment(
          order.id,
          item,
          studentId,
          paymentMode,
        ),
      );
    }
    return { payments };
  }

  /**
   * Records one demand's share of a (possibly multi-demand) verified order.
   * Deterministic per-(order, demand) receipt_no doubles as the idempotency
   * key: a retried/duplicate verify call for the same order hits
   * fee_payments' existing UNIQUE constraint on receipt_no instead of
   * double-crediting, same as the original single-demand design — just
   * applied once per cart item instead of once per order.
   */
  private async recordSingleDemandPayment(
    orderId: string,
    item: FeePaymentItemDto,
    studentId: number,
    paymentMode: 'card' | 'upi' | 'netbanking' | undefined,
  ) {
    const amountPaid = new Prisma.Decimal(item.amount);
    // receipt_no includes the item id when present so two different items
    // of the same demand paid in one order don't collide on the same
    // deterministic idempotency key.
    const receiptNo = `RCP-ONLINE-${orderId}-${item.demand_id}${item.fee_structure_item_id !== undefined ? `-${item.fee_structure_item_id}` : ''}`;

    let demandId: number;
    let isPartial: boolean;
    if (item.fee_structure_item_id !== undefined) {
      const { item: feeItem, paid } = await this.loadItemDue(
        item.demand_id,
        item.fee_structure_item_id,
        studentId,
      );
      demandId = item.demand_id;
      isPartial = paid.plus(amountPaid).lessThan(feeItem.amount);
    } else {
      const { demand, paid } = await this.loadDemandDue(
        item.demand_id,
        studentId,
      );
      demandId = demand.id;
      isPartial = paid.plus(amountPaid).lessThan(demand.total_amount);
    }

    try {
      const payment = await this.prisma.fee_payments.create({
        data: {
          student_fee_demand_mapping_id: demandId,
          fee_structure_item_id: item.fee_structure_item_id,
          amount_paid: amountPaid,
          payment_mode: paymentMode,
          receipt_no: receiptNo,
          is_partial: isPartial,
        },
      });
      return {
        id: payment.id,
        demand_id: demandId,
        amount_paid: Number(payment.amount_paid),
        receipt_no: payment.receipt_no,
        payment_date: payment.payment_date.toISOString().slice(0, 10),
      };
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        const existing = await this.prisma.fee_payments.findUnique({
          where: { receipt_no: receiptNo },
        });
        if (existing) {
          return {
            id: existing.id,
            demand_id: demandId,
            amount_paid: Number(existing.amount_paid),
            receipt_no: existing.receipt_no,
            payment_date: existing.payment_date.toISOString().slice(0, 10),
          };
        }
      }
      this.logger.error(
        `Failed to record online fee payment for order ${orderId}, demand ${item.demand_id}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }
}
