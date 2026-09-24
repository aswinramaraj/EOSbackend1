import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { CreateDishCategoryDto } from './dto/create-dish-category.dto';
import { CreateDishDto } from './dto/create-dish.dto';
import { UpdateDishDto } from './dto/update-dish.dto';

const IMAGE_FOLDER = 'canteen-dishes';

@Injectable()
export class CanteenDishesService {
  private readonly logger = new Logger(CanteenDishesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ───────────────────────────── categories ─────────────────────────────

  async listCategories() {
    const categories = await this.prisma.canteen_dish_categories.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { canteen_dishes: true } } },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      dish_count: c._count.canteen_dishes,
    }));
  }

  async createCategory(dto: CreateDishCategoryDto) {
    try {
      return await this.prisma.canteen_dish_categories.create({
        data: { name: dto.name },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'A category with this name already exists.',
          errorCode: 'DUPLICATE_CATEGORY',
        });
      }
      this.logger.error('DB error creating dish category', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ───────────────────────────── dishes ─────────────────────────────

  async listDishes(categoryId?: number, search?: string) {
    const dishes = await this.prisma.canteen_dishes.findMany({
      where: {
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        canteen_dish_categories: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return dishes.map((d) => this.toDishResponse(d));
  }

  async createDish(dto: CreateDishDto, file: Express.Multer.File | undefined) {
    let imageUrl: string | undefined;
    if (file) imageUrl = await this.uploadImage(file);

    try {
      const dish = await this.prisma.canteen_dishes.create({
        data: {
          name: dto.name,
          category_id: dto.category_id ?? null,
          price: dto.price,
          stock_quantity: dto.stock_quantity ?? 0,
          is_veg: dto.is_veg ?? true,
          is_available: dto.is_available ?? true,
          parcel_available: dto.parcel_available ?? true,
          image_url: imageUrl ?? null,
        },
        include: {
          canteen_dish_categories: { select: { id: true, name: true } },
        },
      });
      return this.toDishResponse(dish);
    } catch (err) {
      this.logger.error('DB error creating dish', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async updateDish(
    id: number,
    dto: UpdateDishDto,
    file: Express.Multer.File | undefined,
  ) {
    await this.assertDishExists(id);

    let imageUrl: string | undefined;
    if (file) imageUrl = await this.uploadImage(file);

    try {
      const dish = await this.prisma.canteen_dishes.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.category_id !== undefined && {
            category_id: dto.category_id,
          }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.stock_quantity !== undefined && {
            stock_quantity: dto.stock_quantity,
          }),
          ...(dto.is_veg !== undefined && { is_veg: dto.is_veg }),
          ...(dto.is_available !== undefined && {
            is_available: dto.is_available,
          }),
          ...(dto.parcel_available !== undefined && {
            parcel_available: dto.parcel_available,
          }),
          ...(imageUrl && { image_url: imageUrl }),
          updated_at: new Date(),
        },
        include: {
          canteen_dish_categories: { select: { id: true, name: true } },
        },
      });
      return this.toDishResponse(dish);
    } catch (err) {
      this.logger.error('DB error updating dish', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async deleteDish(id: number) {
    await this.assertDishExists(id);
    try {
      await this.prisma.canteen_dishes.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      // A dish with a recipe (canteen_recipes.dish_id) or order history
      // (canteen_order_items.dish_id) can't be hard-deleted — order_items
      // only SET NULLs its own dish_id on delete, so that side is safe, but
      // canteen_recipes has no ON DELETE clause of its own beyond the default
      // RESTRICT-via-FK behavior Postgres applies when unspecified.
      if (this.isForeignKeyViolation(err)) {
        throw new ConflictException({
          message:
            'This dish has a recipe linked to it — remove the recipe first.',
          errorCode: 'DISH_HAS_RECIPE',
        });
      }
      this.logger.error('DB error deleting dish', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ───────────────────────────── shared helpers ─────────────────────────────

  private async assertDishExists(id: number): Promise<void> {
    const dish = await this.prisma.canteen_dishes.findUnique({ where: { id } });
    if (!dish) {
      throw new NotFoundException({
        message: 'Dish not found.',
        errorCode: 'DISH_NOT_FOUND',
      });
    }
  }

  private async uploadImage(file: Express.Multer.File): Promise<string> {
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException({
        message: 'Only image files are allowed.',
        errorCode: 'INVALID_FILE_TYPE',
      });
    }
    const { key } = await this.storage.upload(
      IMAGE_FOLDER,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    return this.storage.getPublicUrl(key);
  }

  private toDishResponse(dish: {
    id: number;
    name: string;
    price: unknown;
    stock_quantity: number;
    image_url: string | null;
    is_veg: boolean;
    is_available: boolean;
    parcel_available: boolean;
    created_at: Date;
    updated_at: Date;
    canteen_dish_categories: { id: number; name: string } | null;
  }) {
    return {
      id: dish.id,
      name: dish.name,
      price: Number(dish.price),
      stock_quantity: dish.stock_quantity,
      image_url: dish.image_url,
      is_veg: dish.is_veg,
      is_available: dish.is_available,
      parcel_available: dish.parcel_available,
      category: dish.canteen_dish_categories,
      created_at: dish.created_at.toISOString(),
      updated_at: dish.updated_at.toISOString(),
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2002';
  }

  private isForeignKeyViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2003';
  }
}
