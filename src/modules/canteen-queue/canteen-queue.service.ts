import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/** Only 'placed' (= Paid) orders are pre-ready now — the cashier's only two
 * actions are Paid → Ready and Ready → Received, no intermediate steps. */
const KITCHEN_STATUSES = ['placed'];
const KITCHEN_QUEUE_SIZE = 6;

export interface KitchenQueueItem {
  orderId: number;
  token: string | null;
  status: 'placed';
  createdAt: string;
  items: { name: string; quantity: number; isParcel: boolean }[];
}

export interface KitchenQueuePayload {
  orders: KitchenQueueItem[];
  totalActive: number;
  generatedAt: string;
}

export interface CounterQueueItem {
  orderId: number;
  token: string | null;
  readySince: string;
}

export interface CounterQueuePayload {
  orders: CounterQueueItem[];
  generatedAt: string;
}

@Injectable()
export class CanteenQueueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Up to KITCHEN_QUEUE_SIZE orders not yet ready, oldest first — a FIFO
   * "what to cook next" queue so a busy kitchen's screen never becomes an
   * unbounded wall of tickets. `totalActive` lets the display show "+N more
   * waiting" for anything beyond the visible slots.
   */
  async getKitchenQueue(): Promise<KitchenQueuePayload> {
    const where = {
      order_source: 'self',
      status: { in: KITCHEN_STATUSES },
    } as const;

    const [orders, totalActive] = await Promise.all([
      this.prisma.canteen_orders.findMany({
        where,
        orderBy: { created_at: 'asc' },
        take: KITCHEN_QUEUE_SIZE,
        include: {
          canteen_order_items: {
            include: { canteen_dishes: { select: { name: true } } },
          },
        },
      }),
      this.prisma.canteen_orders.count({ where }),
    ]);

    return {
      orders: orders.map((o) => ({
        orderId: o.id,
        token: o.pickup_token,
        // Narrowed by the `where` filter above — Prisma's column type is a
        // plain string (canteen_orders.status is VarChar, not an enum).
        status: o.status as 'placed',
        createdAt: o.created_at.toISOString(),
        items: o.canteen_order_items.map((i) => ({
          name: i.canteen_dishes?.name ?? 'Item',
          quantity: i.quantity,
          isParcel: i.is_parcel,
        })),
      })),
      totalActive,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Orders ready for pickup, oldest-ready-first. Deliberately excludes item
   * details and orderer identity — this feeds a public, unauthenticated
   * counter screen with nothing but a token number, by design (avoids
   * crowding the counter, avoids exposing any PII on a wall display).
   */
  async getCounterQueue(): Promise<CounterQueuePayload> {
    const orders = await this.prisma.canteen_orders.findMany({
      where: { order_source: 'self', status: 'ready' },
      orderBy: { updated_at: 'asc' },
      select: { id: true, pickup_token: true, updated_at: true },
    });

    return {
      orders: orders.map((o) => ({
        orderId: o.id,
        token: o.pickup_token,
        readySince: o.updated_at.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
