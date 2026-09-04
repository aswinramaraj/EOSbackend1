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
import { CreateStationaryOrderDto } from './dto/create-stationary-order.dto';
import { VerifyStationaryPaymentDto } from './dto/verify-stationary-payment.dto';

// Flat rupees-per-copy rate, by color mode. Placeholder pricing: nothing in
// this schema tracks a document's actual page count (the mobile app never
// parses the uploaded file), so "amount" can't be priced per-page the way
// a real print shop would - this is deliberately simple until that exists.
const PRICING: Record<'color' | 'bw', number> = {
  bw: 2,
  color: 8,
};

@Injectable()
export class StationaryService {
  private readonly logger = new Logger(StationaryService.name);
  private razorpay: Razorpay | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
   * POST /me/stationary-requests/order — mirrors WalletService's own
   * createTopupOrder exactly: create a Razorpay order, stage a matching
   * 'pending_payment' row, return what Razorpay Checkout needs. The
   * request only ever becomes real (status 'paid') once verifyPayment()
   * independently confirms the signature.
   */
  async createOrder(userId: number, dto: CreateStationaryOrderDto) {
    const amount = dto.copies * PRICING[dto.color_mode];
    const razorpay = this.getRazorpay();

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `stationary-${userId}-${Date.now()}`,
    });

    await this.prisma.stationary_requests.create({
      data: {
        user_id: userId,
        file_name: dto.file_name,
        copies: dto.copies,
        orientation: dto.orientation,
        color_mode: dto.color_mode,
        pages: dto.pages,
        amount,
        status: 'pending_payment',
        razorpay_order_id: order.id,
      },
    });

    return {
      order_id: order.id,
      amount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/stationary-requests/order/verify — recomputes the HMAC-SHA256
   * signature server-side (order_id|payment_id, signed with the key
   * secret) rather than trusting the client's claim that Checkout
   * succeeded, same as WalletService.verifyTopup. A signature mismatch
   * leaves the row as 'pending_payment' (no 'failed' state on this
   * smaller table) so the same order can be retried.
   */
  async verifyPayment(userId: number, dto: VerifyStationaryPaymentDto) {
    const request = await this.prisma.stationary_requests.findUnique({
      where: { razorpay_order_id: dto.razorpay_order_id },
    });
    if (!request || request.user_id !== userId) {
      throw new NotFoundException({
        message: 'No matching stationary order found for you',
        errorCode: 'STATIONARY_ORDER_NOT_FOUND',
      });
    }
    if (request.status !== 'pending_payment') {
      throw new BadRequestException({
        message: 'This request has already been processed',
        errorCode: 'ALREADY_PROCESSED',
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
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    const updated = await this.prisma.stationary_requests.update({
      where: { id: request.id },
      data: {
        status: 'paid',
        razorpay_payment_id: dto.razorpay_payment_id,
        razorpay_signature: dto.razorpay_signature,
        updated_at: new Date(),
      },
    });

    this.logger.log(
      `Stationary request paid: id=${updated.id} user=${userId} amount=${updated.amount}`,
    );

    return {
      id: updated.id,
      amount: Number(updated.amount),
      status: updated.status,
    };
  }
}
