import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { ListBillsQueryDto } from './dto/list-bills-query.dto';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

interface BillLine {
  dish_id: number;
  category_id: number | null;
  quantity: number;
  price: number;
  is_parcel: boolean;
}

function deriveBillType(lines: BillLine[]): 'Dine-in' | 'Parcel' | 'Mixed' {
  const hasParcel = lines.some((l) => l.is_parcel);
  const hasDineIn = lines.some((l) => !l.is_parcel);
  if (hasParcel && hasDineIn) return 'Mixed';
  if (hasParcel) return 'Parcel';
  return 'Dine-in';
}

@Injectable()
export class CanteenBillingService {
  private readonly logger = new Logger(CanteenBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createBill(dto: CreateBillDto, cashierUserId: number) {
    const dishIds = [...new Set(dto.items.map((i) => i.dish_id))];
    const dishes = await this.prisma.canteen_dishes.findMany({
      where: { id: { in: dishIds } },
    });
    const dishMap = new Map(dishes.map((d) => [d.id, d]));

    for (const item of dto.items) {
      const dish = dishMap.get(item.dish_id);
      if (!dish) {
        throw new NotFoundException({
          message: `Dish ${item.dish_id} not found.`,
          errorCode: 'DISH_NOT_FOUND',
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
    for (const item of dto.items) {
      qtyByDish.set(
        item.dish_id,
        (qtyByDish.get(item.dish_id) ?? 0) + item.quantity,
      );
    }

    const unavailable = [...qtyByDish.entries()]
      .map(([dishId, qty]) => ({ dish: dishMap.get(dishId)!, qty }))
      .filter(({ dish, qty }) => dish.stock_quantity < qty);

    if (unavailable.length > 0 && !dto.force_emergency) {
      return {
        ok: false as const,
        unavailable_items: unavailable.map(({ dish, qty }) => ({
          dish_id: dish.id,
          dish_name: dish.name,
          requested: qty,
          available: dish.stock_quantity,
        })),
      };
    }

    const isEmergency = unavailable.length > 0 && !!dto.force_emergency;

    const settings = await this.prisma.canteen_settings.findFirst({
      orderBy: { id: 'asc' },
    });
    const gstPercentage = Number(settings?.gst_percentage ?? 0);
    const parcelCharge = Number(settings?.parcel_charge ?? 0);

    let subtotal = 0;
    let parcelTotal = 0;
    const lines: BillLine[] = dto.items.map((item) => {
      const dish = dishMap.get(item.dish_id)!;
      const price = Number(dish.price);
      subtotal += price * item.quantity;
      if (item.is_parcel) parcelTotal += parcelCharge * item.quantity;
      return {
        dish_id: dish.id,
        category_id: dish.category_id,
        quantity: item.quantity,
        price,
        is_parcel: !!item.is_parcel,
      };
    });
    const gstAmount = round2(subtotal * (gstPercentage / 100));
    const totalAmount = round2(subtotal + parcelTotal + gstAmount);
    const billType = deriveBillType(lines);

    try {
      return await this.prisma.$transaction(async (tx) => {
        for (const [dishId, qty] of qtyByDish) {
          if (isEmergency) {
            await tx.canteen_dishes.update({
              where: { id: dishId },
              data: { stock_quantity: { decrement: qty } },
            });
          } else {
            const result = await tx.canteen_dishes.updateMany({
              where: { id: dishId, stock_quantity: { gte: qty } },
              data: { stock_quantity: { decrement: qty } },
            });
            if (result.count === 0) {
              throw new ConflictException({
                message:
                  'Stock changed while this bill was being created — please retry.',
                errorCode: 'STOCK_RACE',
              });
            }
          }
        }

        const order = await tx.canteen_orders.create({
          data: {
            placed_by_user_id: cashierUserId,
            status: 'completed',
            payment_method: dto.payment_mode,
            total_amount: totalAmount,
            order_source: 'cashier',
            is_emergency: isEmergency,
          },
        });

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

        const bill = await tx.canteen_bills.create({
          data: {
            order_id: order.id,
            cashier_user_id: cashierUserId,
            mode_of_payment: dto.payment_mode,
            bill_amount: totalAmount,
            bill_type: billType,
            transaction_status: true,
          },
        });

        return {
          ok: true as const,
          bill_id: bill.id,
          order_id: order.id,
          subtotal: round2(subtotal),
          parcel_charge_total: round2(parcelTotal),
          gst_percentage: gstPercentage,
          gst_amount: gstAmount,
          total_amount: totalAmount,
          bill_type: billType,
          is_emergency: isEmergency,
        };
      });
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error('DB error creating bill', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async listBills(query: ListBillsQueryDto) {
    const bills = await this.prisma.canteen_bills.findMany({
      where: {
        ...((query.from || query.to) && {
          date_time: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to
              ? { lt: new Date(new Date(query.to).getTime() + 86_400_000) }
              : {}),
          },
        }),
      },
      include: {
        users: { select: { id: true, email: true } },
        canteen_orders: {
          include: {
            canteen_order_items: {
              include: { canteen_dishes: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { date_time: 'desc' },
    });

    let items = bills.map((b) => ({
      id: b.id,
      order_id: b.order_id,
      cashier_user_id: b.cashier_user_id,
      cashier: b.users?.email ?? 'Unknown',
      amount: Number(b.bill_amount),
      payment_mode: b.mode_of_payment,
      bill_type: b.bill_type,
      is_active: b.transaction_status,
      is_emergency: b.canteen_orders?.is_emergency ?? false,
      date_time: b.date_time.toISOString(),
      voided_at: b.voided_at?.toISOString() ?? null,
      items:
        b.canteen_orders?.canteen_order_items.map(
          (i) =>
            `${i.canteen_dishes?.name ?? 'Item'} x${i.quantity}${i.is_parcel ? ' (parcel)' : ''}`,
        ) ?? [],
    }));

    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (b) =>
          String(b.id).includes(q) ||
          b.cashier.toLowerCase().includes(q) ||
          b.items.some((i) => i.toLowerCase().includes(q)),
      );
    }

    return {
      items,
      summary: {
        total_bills: items.length,
        active_bills: items.filter((b) => b.is_active).length,
        voided_bills: items.filter((b) => !b.is_active).length,
        emergency_bills: items.filter((b) => b.is_emergency).length,
        total_amount: round2(
          items
            .filter((b) => b.is_active)
            .reduce((sum, b) => sum + b.amount, 0),
        ),
      },
    };
  }

  /** Soft void — only the cashier who created the bill, same calendar day, reverts stock, keeps the row for audit. */
  async voidBill(id: number, cashierUserId: number) {
    const bill = await this.prisma.canteen_bills.findUnique({
      where: { id },
      include: {
        canteen_orders: { include: { canteen_order_items: true } },
      },
    });
    if (!bill) {
      throw new NotFoundException({
        message: 'Bill not found.',
        errorCode: 'BILL_NOT_FOUND',
      });
    }
    if (bill.cashier_user_id !== cashierUserId) {
      throw new ForbiddenException({
        message: 'You can only void bills you created yourself.',
        errorCode: 'NOT_YOUR_BILL',
      });
    }
    if (!bill.transaction_status) {
      throw new ConflictException({
        message: 'This bill has already been voided.',
        errorCode: 'ALREADY_VOIDED',
      });
    }
    if (!isSameCalendarDay(bill.date_time, new Date())) {
      throw new ForbiddenException({
        message: 'Bills can only be voided on the day they were created.',
        errorCode: 'VOID_WINDOW_EXPIRED',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      if (bill.canteen_orders) {
        for (const item of bill.canteen_orders.canteen_order_items) {
          if (item.dish_id != null) {
            await tx.canteen_dishes.update({
              where: { id: item.dish_id },
              data: { stock_quantity: { increment: item.quantity } },
            });
          }
        }
      }
      await tx.canteen_bills.update({
        where: { id },
        data: { transaction_status: false, voided_at: new Date() },
      });
      return { success: true };
    });
  }
}
