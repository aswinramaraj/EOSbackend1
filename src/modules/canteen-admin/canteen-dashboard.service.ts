import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

@Injectable()
export class CanteenDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const { start, end } = todayBounds();

    const bills = await this.prisma.canteen_bills.findMany({
      where: { date_time: { gte: start, lt: end } },
      select: { mode_of_payment: true, bill_amount: true, order_id: true },
    });

    const cashBills = bills.filter((b) => b.mode_of_payment === 'cash');
    const upiBills = bills.filter((b) => b.mode_of_payment === 'upi');
    const sum = (rows: typeof bills) =>
      rows.reduce((s, b) => s + Number(b.bill_amount), 0);

    const orderIds = [
      ...new Set(
        bills.map((b) => b.order_id).filter((id): id is number => id != null),
      ),
    ];
    const items = orderIds.length
      ? await this.prisma.canteen_order_items.findMany({
          where: { order_id: { in: orderIds } },
          include: { canteen_dish_categories: { select: { name: true } } },
        })
      : [];

    const byCategory = new Map<
      string,
      { amount: number; orderIds: Set<number> }
    >();
    for (const item of items) {
      const name = item.canteen_dish_categories?.name ?? 'Uncategorized';
      const entry = byCategory.get(name) ?? {
        amount: 0,
        orderIds: new Set<number>(),
      };
      entry.amount += Number(item.price) * item.quantity;
      if (item.order_id != null) entry.orderIds.add(item.order_id);
      byCategory.set(name, entry);
    }

    return {
      today_total_sales: round2(sum(bills)),
      cash_sales: {
        amount: round2(sum(cashBills)),
        orders: new Set(cashBills.map((b) => b.order_id)).size,
      },
      upi_sales: {
        amount: round2(sum(upiBills)),
        orders: new Set(upiBills.map((b) => b.order_id)).size,
      },
      sales_by_category: [...byCategory.entries()].map(([category, v]) => ({
        category,
        amount: round2(v.amount),
        orders: v.orderIds.size,
      })),
    };
  }
}
