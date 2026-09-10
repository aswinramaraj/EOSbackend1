import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { CreateStationaryOrderDto } from './dto/create-stationary-order.dto';
import { VerifyStationaryPaymentDto } from './dto/verify-stationary-payment.dto';

// ₹2 per printed page - the only pricing rule this module implements.
// Binding/paper size/sides/color are all stored for the print shop's own
// reference but don't change the price (no per-binding/per-color rate has
// ever been specified for this module).
const PRICE_PER_PAGE = 2;

type StationaryRequestRow = {
  id: number;
  user_id: number;
  // The pre-existing column from this table's original design (a single
  // file's name) - reused as-is to hold whatever short summary the client
  // sends for its (possibly multi-file) request, rather than adding yet
  // another near-duplicate column.
  file_name: string | null;
  total_pages: number;
  copies: number;
  orientation: string;
  color_mode: string;
  paper_size: string | null;
  sides: string | null;
  binding: string | null;
  amount: string;
  status: 'pending_payment' | 'paid';
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: Date;
  updated_at: Date;
};

// stationary_requests is a manual-SQL table (see
// prisma/manual-sql/stationary_requests.sql) - not a schema.prisma model,
// per this project's "never modify schema.prisma for a small additive
// table" convention - so every query here is raw SQL via PrismaService's
// $queryRaw/$executeRaw, same pattern as Medical Centre's raw-SQL tables.
@Injectable()
export class StationaryService {
  private readonly logger = new Logger(StationaryService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

  /**
   * POST /me/stationary-requests/order — creates a Razorpay order and a
   * matching `pending_payment` stationary_requests row. The request is
   * only ever marked paid later, by verifyPayment(), once the signature is
   * independently confirmed - mirrors WalletService.createTopupOrder.
   */
  async createOrder(userId: number, dto: CreateStationaryOrderDto) {
    const amount = dto.total_pages * dto.copies * PRICE_PER_PAGE;
    const razorpay = this.getRazorpay();

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `stationary-${userId}-${Date.now()}`,
    });

    try {
      // `pages` (all/even/odd) is a leftover NOT NULL column from this
      // table's original design - the new UI has no equivalent concept
      // (total_pages replaces it), so every new row just gets the 'all'
      // default to satisfy the existing constraint without resurrecting
      // that old selector anywhere.
      await this.prisma.$executeRaw`
        INSERT INTO stationary_requests
          (user_id, file_name, total_pages, copies, orientation, color_mode, pages, paper_size, sides, binding, amount, status, razorpay_order_id)
        VALUES
          (${userId}, ${dto.file_summary ?? null}, ${dto.total_pages}, ${dto.copies}, ${dto.orientation}, ${dto.color_mode}, 'all', ${dto.paper_size}, ${dto.sides}, ${dto.binding}, ${amount}, 'pending_payment', ${order.id})
      `;
    } catch (err) {
      this.logger.error('DB error while creating stationary request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return {
      order_id: order.id,
      amount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/stationary-requests/order/verify — recomputes the
   * HMAC-SHA256 signature server-side (order_id|payment_id, signed with
   * the key secret) rather than trusting the client's claim that Checkout
   * succeeded. Only marks the request paid on a genuine signature match -
   * mirrors WalletService.verifyTopup.
   */
  async verifyPayment(userId: number, dto: VerifyStationaryPaymentDto) {
    const rows = await this.prisma.$queryRaw<StationaryRequestRow[]>`
      SELECT * FROM stationary_requests WHERE razorpay_order_id = ${dto.razorpay_order_id}
    `;
    const request = rows[0];
    if (!request || request.user_id !== userId) {
      throw new NotFoundException({
        message: 'No matching stationary request found for your account',
        errorCode: 'STATIONARY_REQUEST_NOT_FOUND',
      });
    }
    if (request.status !== 'pending_payment') {
      throw new BadRequestException({
        message: 'This request has already been processed',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

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
      await this.prisma.$executeRaw`
        UPDATE stationary_requests
        SET razorpay_payment_id = ${dto.razorpay_payment_id}, razorpay_signature = ${dto.razorpay_signature}, updated_at = now()
        WHERE id = ${request.id}
      `;
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    await this.prisma.$executeRaw`
      UPDATE stationary_requests
      SET status = 'paid', razorpay_payment_id = ${dto.razorpay_payment_id}, razorpay_signature = ${dto.razorpay_signature}, updated_at = now()
      WHERE id = ${request.id}
    `;

    this.logger.log(`Stationary request paid: id=${request.id} amount=${request.amount}`);

    try {
      // No dedicated notification_type_enum value exists for this yet (see
      // that enum in schema.prisma, which this project's convention says
      // never to hand-edit for something this small) - omitting `type`
      // just means a generic icon/no deep link, the same documented
      // fallback CreateNotificationDto already supports.
      await this.notifications.notify({
        user_id: userId,
        title: 'Stationary request paid',
        message: `Your print request (₹${request.amount}) has been paid and sent to the print shop.`,
      });
    } catch (err) {
      this.logger.error(`Failed to notify user ${userId} of stationary payment`, err);
    }

    return { id: request.id, amount: Number(request.amount), status: 'paid' as const };
  }

  /** GET /me/stationary-requests — the caller's own request history, newest first. */
  async listMyRequests(userId: number) {
    const rows = await this.prisma.$queryRaw<StationaryRequestRow[]>`
      SELECT * FROM stationary_requests WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      file_summary: r.file_name,
      total_pages: r.total_pages,
      copies: r.copies,
      orientation: r.orientation,
      color_mode: r.color_mode,
      paper_size: r.paper_size,
      sides: r.sides,
      binding: r.binding,
      amount: Number(r.amount),
      status: r.status,
      created_at: r.created_at,
    }));
  }
}
