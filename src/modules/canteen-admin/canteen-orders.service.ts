import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class CanteenOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read-only oversight for Admin — every order regardless of source, newest first. */
  async list(query: ListOrdersQueryDto) {
    const orders = await this.prisma.canteen_orders.findMany({
      where: {
        ...(query.source ? { order_source: query.source } : {}),
        ...((query.from || query.to) && {
          created_at: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to
              ? { lt: new Date(new Date(query.to).getTime() + 86_400_000) }
              : {}),
          },
        }),
      },
      include: {
        users: { select: { email: true } },
        canteen_order_items: {
          include: { canteen_dishes: { select: { name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });

    const items = orders.map((o) => ({
      id: o.id,
      order_source: o.order_source,
      status: o.status,
      pickup_token: o.pickup_token,
      total_amount: Number(o.total_amount),
      is_emergency: o.is_emergency,
      placed_by: o.users?.email ?? 'Unknown',
      created_at: o.created_at.toISOString(),
      items: o.canteen_order_items.map((i) => ({
        name: i.canteen_dishes?.name ?? 'Item',
        quantity: i.quantity,
        is_parcel: i.is_parcel,
      })),
    }));

    return {
      items,
      summary: {
        total_orders: items.length,
        self_ordered: items.filter((i) => i.order_source === 'self').length,
        cashier_orders: items.filter((i) => i.order_source === 'cashier')
          .length,
        total_amount: round2(items.reduce((sum, i) => sum + i.total_amount, 0)),
      },
    };
  }
}
