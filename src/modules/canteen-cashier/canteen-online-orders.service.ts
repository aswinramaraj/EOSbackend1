import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CanteenQueuePushService } from 'src/modules/canteen-queue/canteen-queue-push.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/**
 * Which status a given status may move to next — enforced server-side so
 * the cashier's UI can't skip a step by a stale click. Deliberately just
 * one real cashier-facing transition (Paid → Ready) — "accepted"/"preparing"
 * were dropped per user feedback; ready → collected is a separate action
 * (see generateBill below).
 */
const NEXT_STATUS: Record<string, string> = {
  placed: 'ready',
};

function deriveBillType(
  items: { is_parcel: boolean }[],
): 'Dine-in' | 'Parcel' | 'Mixed' {
  const hasParcel = items.some((i) => i.is_parcel);
  const hasDineIn = items.some((i) => !i.is_parcel);
  if (hasParcel && hasDineIn) return 'Mixed';
  if (hasParcel) return 'Parcel';
  return 'Dine-in';
}

@Injectable()
export class CanteenOnlineOrdersService {
  private readonly logger = new Logger(CanteenOnlineOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queuePush: CanteenQueuePushService,
  ) {}

  async list(status?: string) {
    const orders = await this.prisma.canteen_orders.findMany({
      where: {
        order_source: 'self',
        ...(status ? { status } : { status: { not: 'cancelled' } }),
      },
      include: {
        users: { select: { email: true } },
        canteen_order_items: {
          include: { canteen_dishes: { select: { name: true } } },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return orders.map((o) => ({
      id: o.id,
      pickup_token: o.pickup_token,
      status: o.status,
      total_amount: Number(o.total_amount),
      orderer: o.users?.email ?? 'Unknown',
      created_at: o.created_at.toISOString(),
      items: o.canteen_order_items.map((i) => ({
        name: i.canteen_dishes?.name ?? 'Item',
        quantity: i.quantity,
      })),
    }));
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto) {
    const order = await this.findSelfOrder(id);
    const expectedCurrent = Object.keys(NEXT_STATUS).find(
      (from) => NEXT_STATUS[from] === dto.status,
    );
    if (order.status !== expectedCurrent) {
      throw new ConflictException({
        message: `This order is "${order.status}" and can't jump to "${dto.status}".`,
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    await this.prisma.canteen_orders.update({
      where: { id },
      data: { status: dto.status, updated_at: new Date() },
    });

    this.queuePush.pushKitchenUpdate();
    if (dto.status === 'ready') this.queuePush.pushCounterUpdate();

    return { success: true, status: dto.status };
  }

  /**
   * The order was already paid (wallet debit at placement) — this just
   * records the in-person handover as a real bill row, same ledger every
   * walk-in Cashier sale lands in, and marks the order collected.
   */
  async generateBill(id: number, cashierUserId: number) {
    const order = await this.findSelfOrder(id);
    if (order.status !== 'ready') {
      throw new ConflictException({
        message:
          'This order must be marked "ready" before generating its bill.',
        errorCode: 'ORDER_NOT_READY',
      });
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const bill = await tx.canteen_bills.create({
          data: {
            order_id: order.id,
            cashier_user_id: cashierUserId,
            mode_of_payment: 'wallet',
            bill_amount: Number(order.total_amount ?? 0),
            bill_type: deriveBillType(order.canteen_order_items),
            transaction_status: true,
          },
        });
        await tx.canteen_orders.update({
          where: { id: order.id },
          data: { status: 'collected' },
        });
        return { bill_id: bill.id, order_id: order.id };
      });
      // The order was ready and just handed over — it leaves the counter queue.
      this.queuePush.pushCounterUpdate();
      return result;
    } catch (err) {
      this.logger.error('DB error generating bill for online order', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findSelfOrder(id: number) {
    const order = await this.prisma.canteen_orders.findUnique({
      where: { id },
      include: { canteen_order_items: true },
    });
    if (!order || order.order_source !== 'self') {
      throw new NotFoundException({
        message: 'Order not found.',
        errorCode: 'ORDER_NOT_FOUND',
      });
    }
    return order;
  }
}
