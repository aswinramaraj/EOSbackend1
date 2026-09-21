import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenDishesService } from 'src/modules/canteen-admin/canteen-dishes.service';
import { CanteenSettingsService } from 'src/modules/canteen-admin/canteen-settings.service';

/**
 * Read-only catalog/config access for the billing/POS screen — reuses
 * CanteenAdminModule's services rather than duplicating their query logic.
 * Dish/category CRUD and settings edits stay exclusively under Canteen
 * Admin; Cashier never gets a write route here.
 */
@Controller('canteen-cashier')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_CASHIER)
export class CanteenCashierDishesController {
  constructor(
    private readonly dishes: CanteenDishesService,
    private readonly settings: CanteenSettingsService,
  ) {}

  @Get('dishes')
  listDishes(
    @Query('category_id') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.dishes.listDishes(
      categoryId ? Number(categoryId) : undefined,
      search,
    );
  }

  @Get('dish-categories')
  listCategories() {
    return this.dishes.listCategories();
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }
}
