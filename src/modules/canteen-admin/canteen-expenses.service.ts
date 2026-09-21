import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateExpenseProductDto } from './dto/create-expense-product.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';

@Injectable()
export class CanteenExpensesService {
  private readonly logger = new Logger(CanteenExpensesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── categories ─────────────────────────────

  async listCategories() {
    return this.prisma.canteen_expense_categories.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(dto: CreateExpenseCategoryDto) {
    try {
      return await this.prisma.canteen_expense_categories.create({
        data: { name: dto.name },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'A category with this name already exists.',
          errorCode: 'DUPLICATE_CATEGORY',
        });
      }
      this.logger.error('DB error creating expense category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ───────────────────────────── products ─────────────────────────────

  async listProducts() {
    return this.prisma.canteen_expense_products.findMany({
      include: {
        canteen_expense_categories: { select: { id: true, name: true } },
      },
      orderBy: { product_name: 'asc' },
    });
  }

  async createProduct(dto: CreateExpenseProductDto) {
    const created = await this.prisma.canteen_expense_products.create({
      data: {
        product_name: dto.product_name,
        category_id: dto.category_id ?? null,
        price_per_unit: dto.price_per_unit,
      },
    });
    return { ...created, price_per_unit: Number(created.price_per_unit) };
  }

  // ───────────────────────────── expenses ─────────────────────────────

  async list(query: ListExpensesQueryDto) {
    const rows = await this.prisma.canteen_expenses.findMany({
      where: {
        ...(query.category_id ? { category_id: query.category_id } : {}),
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
        ...((query.from || query.to) && {
          date: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }),
      },
      include: {
        canteen_expense_categories: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.canteen_expense_categories,
      vendor_name: r.vendor_name,
      quantity: Number(r.quantity),
      total_amount: Number(r.total_amount),
      date: r.date.toISOString(),
    }));

    const byCategory = new Map<string, { amount: number; count: number }>();
    for (const item of items) {
      const key = item.category?.name ?? 'Uncategorized';
      const existing = byCategory.get(key) ?? { amount: 0, count: 0 };
      existing.amount += item.total_amount;
      existing.count += 1;
      byCategory.set(key, existing);
    }

    return {
      items,
      summary: {
        total_expenses:
          Math.round(items.reduce((sum, i) => sum + i.total_amount, 0) * 100) /
          100,
        categories_count: byCategory.size,
        entries_count: items.length,
      },
      by_category: [...byCategory.entries()].map(([name, v]) => ({
        category: name,
        amount: Math.round(v.amount * 100) / 100,
        count: v.count,
      })),
    };
  }

  async create(dto: CreateExpenseDto) {
    const created = await this.prisma.canteen_expenses.create({
      data: {
        name: dto.name,
        category_id: dto.category_id ?? null,
        vendor_name: dto.vendor_name ?? null,
        quantity: dto.quantity,
        total_amount: dto.total_amount,
        ...(dto.date && { date: new Date(dto.date) }),
      },
    });
    return {
      ...created,
      quantity: Number(created.quantity),
      total_amount: Number(created.total_amount),
      date: created.date.toISOString(),
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2002';
  }
}
