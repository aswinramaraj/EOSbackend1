import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@Injectable()
export class CanteenIngredientsService {
  private readonly logger = new Logger(CanteenIngredientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(search?: string) {
    const rows = await this.prisma.canteen_ingredients.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
    });

    const items = rows.map((r) => {
      const stock = Number(r.stock_quantity);
      const threshold = Number(r.threshold);
      const pricePerUnit = Number(r.price_per_unit);
      return {
        id: r.id,
        name: r.name,
        stock_quantity: stock,
        price_per_unit: pricePerUnit,
        threshold,
        value: Math.round(stock * pricePerUnit * 100) / 100,
        status:
          stock <= 0
            ? 'out_of_stock'
            : stock <= threshold
              ? 'low_stock'
              : 'in_stock',
        created_at: r.created_at?.toISOString() ?? null,
      };
    });

    return {
      items,
      summary: {
        total_items: items.length,
        low_stock: items.filter((i) => i.status === 'low_stock').length,
        out_of_stock: items.filter((i) => i.status === 'out_of_stock').length,
        total_value:
          Math.round(items.reduce((sum, i) => sum + i.value, 0) * 100) / 100,
      },
    };
  }

  async create(dto: CreateIngredientDto) {
    try {
      const created = await this.prisma.canteen_ingredients.create({
        data: {
          name: dto.name,
          stock_quantity: dto.stock_quantity ?? 0,
          price_per_unit: dto.price_per_unit,
          threshold: dto.threshold ?? 0,
        },
      });
      return this.toResponse(created);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'An ingredient with this name already exists.',
          errorCode: 'DUPLICATE_INGREDIENT',
        });
      }
      this.logger.error('DB error creating ingredient', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async update(id: number, dto: UpdateIngredientDto) {
    const existing = await this.prisma.canteen_ingredients.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Ingredient not found.',
        errorCode: 'INGREDIENT_NOT_FOUND',
      });
    }
    try {
      const updated = await this.prisma.canteen_ingredients.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.stock_quantity !== undefined && {
            stock_quantity: dto.stock_quantity,
          }),
          ...(dto.price_per_unit !== undefined && {
            price_per_unit: dto.price_per_unit,
          }),
          ...(dto.threshold !== undefined && { threshold: dto.threshold }),
        },
      });
      return this.toResponse(updated);
    } catch (err) {
      this.logger.error('DB error updating ingredient', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async delete(id: number) {
    const existing = await this.prisma.canteen_ingredients.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Ingredient not found.',
        errorCode: 'INGREDIENT_NOT_FOUND',
      });
    }
    try {
      await this.prisma.canteen_ingredients.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if (this.isForeignKeyViolation(err)) {
        throw new ConflictException({
          message:
            'This ingredient is used in a recipe — remove it from the recipe first.',
          errorCode: 'INGREDIENT_IN_USE',
        });
      }
      this.logger.error('DB error deleting ingredient', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private toResponse(row: {
    id: number;
    name: string;
    stock_quantity: unknown;
    price_per_unit: unknown;
    threshold: unknown;
    created_at: Date | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      stock_quantity: Number(row.stock_quantity),
      price_per_unit: Number(row.price_per_unit),
      threshold: Number(row.threshold),
      created_at: row.created_at?.toISOString() ?? null,
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2002';
  }

  private isForeignKeyViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2003';
  }
}
