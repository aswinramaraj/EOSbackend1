import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';

@Injectable()
export class CanteenRecipesService {
  private readonly logger = new Logger(CanteenRecipesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(search?: string) {
    const recipes = await this.prisma.canteen_recipes.findMany({
      where: search
        ? {
            canteen_dishes: { name: { contains: search, mode: 'insensitive' } },
          }
        : {},
      include: {
        canteen_dishes: { select: { id: true, name: true } },
        canteen_recipe_ingredients: {
          include: {
            canteen_ingredients: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { canteen_dishes: { name: 'asc' } },
    });

    return recipes.map((r) => ({
      id: r.id,
      dish: r.canteen_dishes,
      ingredients: r.canteen_recipe_ingredients.map((ri) => ({
        ingredient_id: ri.ingredient_id,
        name: ri.canteen_ingredients.name,
        quantity_needed: Number(ri.quantity_needed),
        unit: ri.unit,
      })),
      created_at: r.created_at?.toISOString() ?? null,
    }));
  }

  async summary() {
    const [totalRecipes, totalDishes, totalIngredients] = await Promise.all([
      this.prisma.canteen_recipes.count(),
      this.prisma.canteen_dishes.count(),
      this.prisma.canteen_ingredients.count(),
    ]);
    return {
      total_recipes: totalRecipes,
      available_dishes: totalDishes,
      available_ingredients: totalIngredients,
    };
  }

  /** Create-or-replace: a dish has at most one recipe, so re-submitting the same dish_id replaces its ingredient list wholesale rather than requiring the caller to diff it themselves. */
  async upsert(dto: UpsertRecipeDto) {
    const dish = await this.prisma.canteen_dishes.findUnique({
      where: { id: dto.dish_id },
    });
    if (!dish) {
      throw new NotFoundException({
        message: 'Dish not found.',
        errorCode: 'DISH_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const recipe = await tx.canteen_recipes.upsert({
          where: { dish_id: dto.dish_id },
          create: { dish_id: dto.dish_id },
          update: { updated_at: new Date() },
        });

        await tx.canteen_recipe_ingredients.deleteMany({
          where: { recipe_id: recipe.id },
        });
        await tx.canteen_recipe_ingredients.createMany({
          data: dto.ingredients.map((line) => ({
            recipe_id: recipe.id,
            ingredient_id: line.ingredient_id,
            quantity_needed: line.quantity_needed,
            unit: line.unit,
          })),
        });

        return { id: recipe.id, dish_id: recipe.dish_id };
      });
    } catch (err) {
      this.logger.error('DB error upserting recipe', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async delete(id: number) {
    const existing = await this.prisma.canteen_recipes.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Recipe not found.',
        errorCode: 'RECIPE_NOT_FOUND',
      });
    }
    await this.prisma.canteen_recipes.delete({ where: { id } });
    return { success: true };
  }
}
