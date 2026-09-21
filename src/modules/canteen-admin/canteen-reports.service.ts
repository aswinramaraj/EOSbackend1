import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DateRangeQueryDto } from './dto/date-range-query.dto';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveRange(query: DateRangeQueryDto): { start: Date; end: Date } {
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = query.from ? new Date(query.from) : todayStart;
  const end = query.to
    ? new Date(new Date(query.to).getTime() + 24 * 60 * 60 * 1000)
    : new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class CanteenReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Billing Details tab: cashier performance, sales-by-category, recent bills. */
  async getBillingDetails(query: DateRangeQueryDto) {
    const { start, end } = resolveRange(query);

    const bills = await this.prisma.canteen_bills.findMany({
      where: { date_time: { gte: start, lt: end } },
      include: {
        users: { select: { id: true, email: true } },
      },
      orderBy: { date_time: 'desc' },
    });

    const cashierMap = new Map<
      string,
      { bills: number; cash: number; upi: number }
    >();
    for (const bill of bills) {
      const key = bill.users?.email ?? 'Unknown';
      const entry = cashierMap.get(key) ?? { bills: 0, cash: 0, upi: 0 };
      entry.bills += 1;
      if (bill.mode_of_payment === 'cash')
        entry.cash += Number(bill.bill_amount);
      else if (bill.mode_of_payment === 'upi')
        entry.upi += Number(bill.bill_amount);
      cashierMap.set(key, entry);
    }

    const orderIds = [
      ...new Set(
        bills.map((b) => b.order_id).filter((id): id is number => id != null),
      ),
    ];
    const items = orderIds.length
      ? await this.prisma.canteen_order_items.findMany({
          where: { order_id: { in: orderIds } },
          include: {
            canteen_dish_categories: { select: { name: true } },
            canteen_dishes: { select: { name: true } },
          },
        })
      : [];
    const itemsByOrder = new Map<number, typeof items>();
    for (const item of items) {
      if (item.order_id == null) continue;
      const arr = itemsByOrder.get(item.order_id) ?? [];
      arr.push(item);
      itemsByOrder.set(item.order_id, arr);
    }

    const byCategory = new Map<string, { amount: number; quantity: number }>();
    for (const item of items) {
      const name = item.canteen_dish_categories?.name ?? 'Uncategorized';
      const entry = byCategory.get(name) ?? { amount: 0, quantity: 0 };
      entry.amount += Number(item.price) * item.quantity;
      entry.quantity += item.quantity;
      byCategory.set(name, entry);
    }

    return {
      summary: {
        total_bills: bills.length,
        cash_amount: round2(
          bills
            .filter((b) => b.mode_of_payment === 'cash')
            .reduce((s, b) => s + Number(b.bill_amount), 0),
        ),
        upi_amount: round2(
          bills
            .filter((b) => b.mode_of_payment === 'upi')
            .reduce((s, b) => s + Number(b.bill_amount), 0),
        ),
      },
      cashier_performance: [...cashierMap.entries()].map(([cashier, v]) => ({
        cashier,
        bills: v.bills,
        cash: round2(v.cash),
        upi: round2(v.upi),
        total: round2(v.cash + v.upi),
      })),
      sales_by_category: [...byCategory.entries()].map(([category, v]) => ({
        category,
        amount: round2(v.amount),
        quantity: v.quantity,
      })),
      recent_bills: bills.slice(0, 50).map((b) => ({
        id: b.id,
        date_time: b.date_time.toISOString(),
        cashier: b.users?.email ?? 'Unknown',
        amount: Number(b.bill_amount),
        payment: b.mode_of_payment,
        items:
          (b.order_id != null ? itemsByOrder.get(b.order_id) : undefined)?.map(
            (i) => `${i.canteen_dishes?.name ?? 'Item'} (${i.quantity})`,
          ) ?? [],
      })),
    };
  }

  /** Reports & Analytics tab: total sales/expenses/net profit, daily sales summary. */
  async getAnalytics(query: DateRangeQueryDto) {
    const { start, end } = resolveRange(query);

    const [bills, expenses] = await Promise.all([
      this.prisma.canteen_bills.findMany({
        where: { date_time: { gte: start, lt: end } },
        select: { bill_amount: true, date_time: true },
      }),
      this.prisma.canteen_expenses.findMany({
        where: { date: { gte: start, lt: end } },
        select: { total_amount: true },
      }),
    ]);

    const totalSales = bills.reduce((s, b) => s + Number(b.bill_amount), 0);
    const totalExpenses = expenses.reduce(
      (s, e) => s + Number(e.total_amount),
      0,
    );

    const byDate = new Map<string, number>();
    for (const bill of bills) {
      const day = bill.date_time.toISOString().slice(0, 10);
      byDate.set(day, (byDate.get(day) ?? 0) + Number(bill.bill_amount));
    }

    return {
      total_sales: round2(totalSales),
      total_expenses: round2(totalExpenses),
      net_profit: round2(totalSales - totalExpenses),
      daily_sales_summary: [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, sales]) => ({ date, sales: round2(sales) })),
    };
  }
}
