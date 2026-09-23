import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from 'src/prisma/prisma.service';
import { CanteenSettingsService } from 'src/modules/canteen-admin/canteen-settings.service';
import { WalletService } from 'src/modules/wallet/wallet.service';
import { CanteenQueuePushService } from 'src/modules/canteen-queue/canteen-queue-push.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpayOrderDto } from './dto/verify-razorpay-order.dto';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Same local-day (IST) truncation pattern as medical-centre-opd.service.ts's startOfDay() — never derive "today" via .toISOString(), which silently returns the previous day between 12:00-5:29 AM IST. */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Orders a person can still back out of — once the cashier marks it 'ready', the canteen has already committed ingredients to it. */
const CANCELLABLE_STATUSES = ['placed'];

const MAX_TOKEN_ATTEMPTS = 8;

/**
 * With the pg driver adapter (Prisma 7), a raw Postgres error from
 * $queryRaw doesn't surface as a bare `err.code` — it's wrapped as a
 * PrismaClientKnownRequestError with its own code ('P2010'), and the real
 * Postgres SQLSTATE is buried under `err.meta.driverAdapterError.cause`
 * (see transport-bus-write.service.ts for the same finding). Check every
 * shape, plus a message-substring fallback (same defensive style as
 * medical-appointments.service.ts's isUniqueViolation), so this keeps
 * working regardless of exactly how a given Prisma version/path surfaces it.
 */
function pgErrorMatches(
  err: unknown,
  sqlState: string,
  messageHint: string,
): boolean {
  const e = err as {
    code?: string;
    message?: string;
    meta?: {
      code?: string;
      driverAdapterError?: { cause?: { originalCode?: string } };
    };
  } | null;
  if (e?.code === sqlState) return true;
  if (e?.meta?.code === sqlState) return true;
  if (e?.meta?.driverAdapterError?.cause?.originalCode === sqlState) {
    return true;
  }
  return (e?.message ?? '').includes(messageHint);
}

/** Signal that canteen_queue_display.query.md's `token_date` column hasn't been added yet. */
function isUndefinedColumnError(err: unknown): boolean {
  return pgErrorMatches(err, '42703', 'token_date');
}

/** Signal that this attempt's random token collided with another order already placed the same day. */
function isTokenCollisionError(err: unknown): boolean {
  return pgErrorMatches(err, '23505', 'uq_canteen_orders_token_per_day');
}

@Injectable()
export class CanteenOrderingService {
  private readonly logger = new Logger(CanteenOrderingService.name);
  private razorpay: Razorpay | null = null;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CanteenSettingsService,
    private readonly wallet: WalletService,
    private readonly queuePush: CanteenQueuePushService,
  ) {}

  /**
   * Shared validation + pricing for every checkout path (wallet, and the
   * two-step Razorpay flow below) - re-fetches dishes/settings fresh from
   * the DB and never trusts a client-supplied price, same "price server-side,
   * always" rule as StationeryService.priceCart. Availability/parcel/stock
   * are checked here too, but this alone does NOT reserve stock - only the
   * real decrement inside a DB transaction (in placeOrder, or in
   * verifyRazorpayPayment) does that.
   */
  private async priceCart(items: PlaceOrderDto['items']) {
    const dishIds = [...new Set(items.map((i) => i.dish_id))];
    const dishes = await this.prisma.canteen_dishes.findMany({
      where: { id: { in: dishIds } },
    });
    const dishMap = new Map(dishes.map((d) => [d.id, d]));

    for (const item of items) {
      const dish = dishMap.get(item.dish_id);
      if (!dish) {
        throw new NotFoundException({
          message: `Dish ${item.dish_id} not found.`,
          errorCode: 'DISH_NOT_FOUND',
        });
      }
      if (!dish.is_available) {
        throw new BadRequestException({
          message: `${dish.name} isn't available right now.`,
          errorCode: 'DISH_UNAVAILABLE',
        });
      }
      if (item.is_parcel && !dish.parcel_available) {
        throw new BadRequestException({
          message: `${dish.name} isn't available as a parcel.`,
          errorCode: 'PARCEL_NOT_AVAILABLE',
        });
      }
    }

    const qtyByDish = new Map<number, number>();
    for (const item of items) {
      qtyByDish.set(
        item.dish_id,
        (qtyByDish.get(item.dish_id) ?? 0) + item.quantity,
      );
    }
    for (const [dishId, qty] of qtyByDish) {
      const dish = dishMap.get(dishId)!;
      if (dish.stock_quantity < qty) {
        throw new BadRequestException({
          message: `${dish.name} doesn't have enough stock right now (only ${dish.stock_quantity} left).`,
          errorCode: 'INSUFFICIENT_STOCK',
        });
      }
    }

    const { parcel_charge: parcelCharge } = await this.settings.get();

    let subtotal = 0;
    let parcelTotal = 0;
    const lines = items.map((item) => {
      const dish = dishMap.get(item.dish_id)!;
      const price = Number(dish.price);
      subtotal += price * item.quantity;
      if (item.is_parcel) parcelTotal += parcelCharge * item.quantity;
      return {
        dish_id: dish.id,
        category_id: dish.category_id,
        quantity: item.quantity,
        price,
        name: dish.name,
        is_parcel: !!item.is_parcel,
      };
    });
    // GST removed from student checkout entirely (per product decision) -
    // gstPercentage/gstAmount are kept as always-0 fields in the response
    // shape rather than deleted, so callers built against them don't break.
    const gstPercentage = 0;
    const gstAmount = 0;
    const totalAmount = round2(subtotal + parcelTotal);

    return { qtyByDish, lines, subtotal, parcelTotal, gstPercentage, gstAmount, totalAmount };
  }

  async placeOrder(userId: number, dto: PlaceOrderDto) {
    const { qtyByDish, lines, subtotal, parcelTotal, gstPercentage, gstAmount, totalAmount } =
      await this.priceCart(dto.items);

    const canteenOutlet = await this.prisma.wallet_outlets.findFirstOrThrow({
      where: { outlet_type: 'canteen' },
    });

    const summaryText = lines.map((l) => `${l.name} x${l.quantity}`).join(', ');
    const { transactionId, balance } = await this.wallet.debitForPurchase(
      userId,
      dto.pin,
      totalAmount,
      canteenOutlet.id,
      `Canteen order: ${summaryText}`,
    );

    const today = startOfDay(new Date());
    // Once a raw INSERT referencing token_date fails because the column
    // doesn't exist yet, Postgres poisons that whole transaction (25P02) —
    // no further statement can run in it, so falling back to the legacy
    // scheme can NEVER happen mid-transaction. Instead, the attempt that
    // discovers the gap fails outright (transaction rolls back cleanly,
    // including the stock decrement) and the next attempt retries in a
    // brand-new transaction with this flag set, skipping the raw INSERT
    // entirely from then on.
    let useLegacyToken = false;

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = String(100 + Math.floor(Math.random() * 900));
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          for (const [dishId, qty] of qtyByDish) {
            const result = await tx.canteen_dishes.updateMany({
              where: { id: dishId, stock_quantity: { gte: qty } },
              data: { stock_quantity: { decrement: qty } },
            });
            if (result.count === 0) {
              throw new BadRequestException({
                message:
                  'Stock changed while placing this order — please retry.',
                errorCode: 'STOCK_RACE',
              });
            }
          }

          let order: {
            id: number;
            pickup_token: string | null;
            status: string;
          };
          if (useLegacyToken) {
            // token_date column not migrated yet (see
            // canteen_queue_display.query.md) — fall back to the legacy
            // sequential token so ordering keeps working; the new
            // daily-reset random-token scheme activates automatically once
            // that migration lands, with no redeploy needed.
            const created = await tx.canteen_orders.create({
              data: {
                placed_by_user_id: userId,
                status: 'placed',
                payment_method: 'wallet',
                payment_status: 'paid',
                total_amount: totalAmount,
                order_source: 'self',
                wallet_transaction_id: transactionId,
              },
            });
            order = await tx.canteen_orders.update({
              where: { id: created.id },
              data: {
                pickup_token: `CV${String(created.id).padStart(5, '0')}`,
              },
            });
          } else {
            const rows = await tx.$queryRaw<
              { id: number; pickup_token: string; status: string }[]
            >`
              INSERT INTO canteen_orders
                (placed_by_user_id, status, payment_method, payment_status, total_amount, order_source, wallet_transaction_id, pickup_token, token_date)
              VALUES
                (${userId}, 'placed', 'wallet', 'paid', ${totalAmount}, 'self', ${transactionId}, ${token}, ${today})
              RETURNING id, pickup_token, status
            `;
            order = rows[0];
          }

          await tx.canteen_order_items.createMany({
            data: lines.map((l) => ({
              order_id: order.id,
              dish_id: l.dish_id,
              category_id: l.category_id,
              quantity: l.quantity,
              price: l.price,
              is_parcel: l.is_parcel,
            })),
          });

          return {
            order_id: order.id,
            pickup_token: order.pickup_token,
            status: order.status,
            subtotal: round2(subtotal),
            parcel_total: round2(parcelTotal),
            gst_percentage: gstPercentage,
            gst_amount: gstAmount,
            total_amount: totalAmount,
            wallet_balance: balance,
          };
        });

        this.queuePush.pushKitchenUpdate();
        return result;
      } catch (err) {
        if (!useLegacyToken && isUndefinedColumnError(err)) {
          // Discovered the schema gap — the poisoned transaction already
          // rolled back in full. Retry in a fresh transaction using the
          // legacy scheme from here on; doesn't consume a real
          // collision-retry attempt.
          useLegacyToken = true;
          attempt--;
          continue;
        }
        if (isTokenCollisionError(err) && attempt < MAX_TOKEN_ATTEMPTS) {
          // Same-day token collision against uq_canteen_orders_token_per_day
          // — the whole transaction rolled back already, including the
          // stock decrement, so nothing needs manual cleanup here. Draw a
          // fresh token and retry the whole thing.
          continue;
        }
        // The wallet debit already committed (it's its own transaction) - if
        // the order itself then fails, refund immediately rather than leaving
        // someone charged with nothing to show for it.
        await this.wallet.refundPurchase(
          transactionId,
          'Refund: order could not be placed',
        );
        if (err instanceof BadRequestException) throw err;
        this.logger.error('DB error placing order', err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }

    // Exhausted every attempt without landing on a free token — astronomically
    // unlikely at up to 900 slots/day, but must fail loudly rather than hang
    // or silently duplicate one.
    await this.wallet.refundPurchase(
      transactionId,
      'Refund: order could not be placed',
    );
    throw new InternalServerErrorException({
      message: 'Could not allocate a pickup token. Please try again.',
      errorCode: 'TOKEN_ALLOCATION_FAILED',
    });
  }

  // ── Checkout: Razorpay (two-step, same shape as the Stationery Store) ───

  /**
   * POST /me/canteen-ordering/checkout/razorpay-order — stages a Razorpay
   * order and a matching `pending` canteen_orders row (items written now,
   * so verifyRazorpayPayment never has to trust anything the client sends
   * back). Deliberately does NOT touch stock yet - only verifyRazorpayPayment
   * does, once payment is confirmed, so an abandoned/failed Razorpay
   * checkout never reserves inventory.
   */
  async createRazorpayOrder(userId: number, dto: CreateRazorpayOrderDto) {
    const { lines, totalAmount } = await this.priceCart(dto.items);

    const razorpay = this.getRazorpay();
    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `canteen-${userId}-${Date.now()}`,
    });

    const staged = await this.prisma.canteen_orders.create({
      data: {
        placed_by_user_id: userId,
        status: 'pending',
        payment_method: 'razorpay',
        payment_status: 'pending',
        total_amount: totalAmount,
        order_source: 'self',
        razorpay_order_id: order.id,
      },
    });
    await this.prisma.canteen_order_items.createMany({
      data: lines.map((l) => ({
        order_id: staged.id,
        dish_id: l.dish_id,
        category_id: l.category_id,
        quantity: l.quantity,
        price: l.price,
        is_parcel: l.is_parcel,
      })),
    });

    return {
      order_id: order.id,
      amount: totalAmount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/canteen-ordering/checkout/razorpay-verify — recomputes the
   * HMAC-SHA256 signature server-side (never trusts the client's claim of
   * success), then decrements stock and allocates the pickup token under
   * the same race-safe transaction + collision-retry loop as placeOrder's
   * wallet path, re-reading the items staged at createRazorpayOrder time
   * rather than anything the client sends now.
   */
  async verifyRazorpayPayment(userId: number, dto: VerifyRazorpayOrderDto) {
    const order = await this.prisma.canteen_orders.findUnique({
      where: { razorpay_order_id: dto.razorpay_order_id },
      include: { canteen_order_items: true },
    });
    if (!order || order.placed_by_user_id !== userId) {
      throw new NotFoundException({
        message: 'No matching order found for your account',
        errorCode: 'GATEWAY_ORDER_NOT_FOUND',
      });
    }
    if (order.payment_status !== 'pending') {
      throw new BadRequestException({
        message: 'This order has already been processed',
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
      await this.prisma.canteen_orders.update({
        where: { id: order.id },
        data: {
          payment_status: 'failed',
          razorpay_payment_id: dto.razorpay_payment_id,
          razorpay_signature: dto.razorpay_signature,
        },
      });
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    if (order.canteen_order_items.length === 0) {
      // Defensive - should be unreachable once createRazorpayOrder always
      // writes items (see that method).
      throw new InternalServerErrorException({
        message: 'Order has no items to fulfil',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const qtyByDish = new Map<number, number>();
    for (const item of order.canteen_order_items) {
      if (item.dish_id == null) continue;
      qtyByDish.set(
        item.dish_id,
        (qtyByDish.get(item.dish_id) ?? 0) + item.quantity,
      );
    }

    const today = startOfDay(new Date());
    let useLegacyToken = false;

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = String(100 + Math.floor(Math.random() * 900));
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          for (const [dishId, qty] of qtyByDish) {
            const decremented = await tx.canteen_dishes.updateMany({
              where: { id: dishId, stock_quantity: { gte: qty } },
              data: { stock_quantity: { decrement: qty } },
            });
            if (decremented.count === 0) {
              throw new UnprocessableEntityException({
                message: 'Stock changed while your payment was processing - your payment will be refunded',
                errorCode: 'INSUFFICIENT_STOCK',
              });
            }
          }

          if (useLegacyToken) {
            return tx.canteen_orders.update({
              where: { id: order.id },
              data: {
                status: 'placed',
                payment_status: 'paid',
                pickup_token: `CV${String(order.id).padStart(5, '0')}`,
                razorpay_payment_id: dto.razorpay_payment_id,
                razorpay_signature: dto.razorpay_signature,
              },
            });
          }
          await tx.$executeRaw`
            UPDATE canteen_orders
            SET status = 'placed', payment_status = 'paid', pickup_token = ${token}, token_date = ${today},
                razorpay_payment_id = ${dto.razorpay_payment_id}, razorpay_signature = ${dto.razorpay_signature}
            WHERE id = ${order.id}
          `;
          return tx.canteen_orders.findUniqueOrThrow({ where: { id: order.id } });
        });

        this.queuePush.pushKitchenUpdate();
        // Re-derive the same breakdown placeOrder's own return uses (this
        // table only stores total_amount, not the subtotal/GST split) -
        // from the items staged at createRazorpayOrder time, never from
        // anything the client sends at verify time.
        const priced = await this.priceCart(
          order.canteen_order_items
            .filter((i) => i.dish_id != null)
            .map((i) => ({ dish_id: i.dish_id!, quantity: i.quantity, is_parcel: i.is_parcel })),
        );
        return {
          order_id: result.id,
          pickup_token: result.pickup_token,
          status: result.status,
          subtotal: round2(priced.subtotal),
          parcel_total: round2(priced.parcelTotal),
          gst_percentage: priced.gstPercentage,
          gst_amount: priced.gstAmount,
          total_amount: Number(result.total_amount),
        };
      } catch (err) {
        if (!useLegacyToken && isUndefinedColumnError(err)) {
          useLegacyToken = true;
          attempt--;
          continue;
        }
        if (isTokenCollisionError(err) && attempt < MAX_TOKEN_ATTEMPTS) {
          continue;
        }
        // The money has already been charged by Razorpay - mark the order
        // failed for manual reconciliation/refund rather than leaving it
        // stuck 'pending' forever, same as the Stationery Store's identical
        // catch block.
        await this.prisma.canteen_orders.update({
          where: { id: order.id },
          data: {
            payment_status: 'failed',
            razorpay_payment_id: dto.razorpay_payment_id,
            razorpay_signature: dto.razorpay_signature,
          },
        });
        if (err instanceof UnprocessableEntityException || err instanceof BadRequestException) throw err;
        this.logger.error('DB error verifying canteen Razorpay payment', err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }

    await this.prisma.canteen_orders.update({
      where: { id: order.id },
      data: { payment_status: 'failed' },
    });
    throw new InternalServerErrorException({
      message: 'Could not allocate a pickup token. Please try again.',
      errorCode: 'TOKEN_ALLOCATION_FAILED',
    });
  }

  async listMyOrders(userId: number) {
    const todayStart = startOfDay(new Date());
    const orders = await this.prisma.canteen_orders.findMany({
      where: {
        placed_by_user_id: userId,
        order_source: 'self',
        // Never surface an abandoned/never-completed Razorpay checkout
        // attempt (staged but never verified) in order history - same
        // exclusion the Stationery Store applies for the identical reason.
        NOT: { status: 'pending', payment_status: 'pending' },
        OR: [
          // Placed today (customer-facing "today's orders" scope)...
          { created_at: { gte: todayStart } },
          // ...or still active from before midnight, so an order that was
          // still preparing/ready right before the day rolled over doesn't
          // vanish from the customer's own view mid-pickup.
          { status: { notIn: ['collected', 'cancelled'] } },
        ],
      },
      include: {
        canteen_order_items: {
          include: { canteen_dishes: { select: { name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return orders.map((o) => this.toOrderSummary(o));
  }

  /**
   * GET /me/children/:studentId/craveo-orders (Parent only, via
   * ParentsService - not directly HTTP-routed here). Full order history,
   * not the today/still-active scope listMyOrders applies for the
   * student's own "Orders" tab - a parent's read-only view is meant to be
   * a genuine history, not a live-session view.
   */
  async listOrdersForStudentUserId(userId: number) {
    const orders = await this.prisma.canteen_orders.findMany({
      where: {
        placed_by_user_id: userId,
        order_source: 'self',
        NOT: { status: 'pending', payment_status: 'pending' },
      },
      include: {
        canteen_order_items: {
          include: { canteen_dishes: { select: { name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return orders.map((o) => this.toOrderSummary(o));
  }

  async getOrder(userId: number, orderId: number) {
    const order = await this.findOwnOrder(userId, orderId);
    return this.toOrderSummary(order);
  }

  async cancelOrder(userId: number, orderId: number) {
    const order = await this.findOwnOrder(userId, orderId);
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      throw new ForbiddenException({
        message:
          'This order is already being prepared and can no longer be cancelled.',
        errorCode: 'ORDER_NOT_CANCELLABLE',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of order.canteen_order_items) {
        if (item.dish_id != null) {
          await tx.canteen_dishes.update({
            where: { id: item.dish_id },
            data: { stock_quantity: { increment: item.quantity } },
          });
        }
      }
      await tx.canteen_orders.update({
        where: { id: order.id },
        data: {
          status: 'cancelled',
          payment_status: order.wallet_transaction_id ? 'refunded' : order.payment_status,
        },
      });
      if (order.wallet_transaction_id) {
        await this.wallet.refundPurchase(
          order.wallet_transaction_id,
          `Refund: order #${order.id} cancelled`,
        );
      } else if (order.payment_method === 'razorpay' && order.payment_status === 'paid') {
        // No live Razorpay refund API call here (a real gateway refund
        // integration is a separate, larger scope) - flagged for finance to
        // action manually, same "surface it, don't silently swallow it"
        // philosophy as the Stationery Store's identical cancel path.
        this.logger.warn(
          `Canteen order ${order.id} cancelled after Razorpay payment — needs a manual gateway refund (no live refund API call made here)`,
        );
      }
      return { success: true };
    });
    // A cancelled placed/accepted order leaves the kitchen's active set.
    this.queuePush.pushKitchenUpdate();
    return result;
  }

  private async findOwnOrder(userId: number, orderId: number) {
    const order = await this.prisma.canteen_orders.findUnique({
      where: { id: orderId },
      include: {
        canteen_order_items: {
          include: { canteen_dishes: { select: { name: true } } },
        },
      },
    });
    if (
      !order ||
      order.placed_by_user_id !== userId ||
      order.order_source !== 'self'
    ) {
      throw new NotFoundException({
        message: 'Order not found.',
        errorCode: 'ORDER_NOT_FOUND',
      });
    }
    return order;
  }

  private toOrderSummary(order: {
    id: number;
    status: string;
    total_amount: unknown;
    pickup_token: string | null;
    created_at: Date;
    payment_method: string | null;
    payment_status: string | null;
    canteen_order_items: {
      quantity: number;
      is_parcel: boolean;
      price: unknown;
      canteen_dishes: { name: string } | null;
    }[];
  }) {
    return {
      id: order.id,
      status: order.status,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      total_amount: Number(order.total_amount),
      pickup_token: order.pickup_token,
      created_at: order.created_at.toISOString(),
      items: order.canteen_order_items.map((i) => ({
        name: i.canteen_dishes?.name ?? 'Item',
        quantity: i.quantity,
        is_parcel: i.is_parcel,
        price: Number(i.price),
      })),
    };
  }

  /** GET /me/canteen-ordering/settings — live GST/parcel rates, so the cart can preview the exact total before ordering. */
  async getSettings() {
    const { gst_percentage, parcel_charge } = await this.settings.get();
    return { gst_percentage, parcel_charge };
  }
}
