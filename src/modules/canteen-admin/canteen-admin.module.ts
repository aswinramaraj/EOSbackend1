import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { CanteenDashboardController } from './canteen-dashboard.controller';
import { CanteenDashboardService } from './canteen-dashboard.service';
import { CanteenDishesController } from './canteen-dishes.controller';
import { CanteenDishesService } from './canteen-dishes.service';
import { CanteenIngredientsController } from './canteen-ingredients.controller';
import { CanteenIngredientsService } from './canteen-ingredients.service';
import { CanteenRecipesController } from './canteen-recipes.controller';
import { CanteenRecipesService } from './canteen-recipes.service';
import { CanteenExpensesController } from './canteen-expenses.controller';
import { CanteenExpensesService } from './canteen-expenses.service';
import { CanteenTodaysSpecialController } from './canteen-todays-special.controller';
import { CanteenTodaysSpecialService } from './canteen-todays-special.service';
import { CanteenReportsController } from './canteen-reports.controller';
import { CanteenReportsService } from './canteen-reports.service';
import { CanteenSettingsController } from './canteen-settings.controller';
import { CanteenSettingsService } from './canteen-settings.service';
import { CanteenOrdersController } from './canteen-orders.controller';
import { CanteenOrdersService } from './canteen-orders.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [
    CanteenDashboardController,
    CanteenDishesController,
    CanteenIngredientsController,
    CanteenRecipesController,
    CanteenExpensesController,
    CanteenTodaysSpecialController,
    CanteenReportsController,
    CanteenSettingsController,
    CanteenOrdersController,
  ],
  providers: [
    CanteenDashboardService,
    CanteenDishesService,
    CanteenIngredientsService,
    CanteenRecipesService,
    CanteenExpensesService,
    CanteenTodaysSpecialService,
    CanteenReportsService,
    CanteenSettingsService,
    CanteenOrdersService,
  ],
  // Both reused read-only by CanteenCashierModule — dish browsing for the
  // POS screen, and the current GST%/parcel charge so the billing screen can
  // preview an accurate total before submitting — rather than duplicating
  // either service's query logic.
  exports: [CanteenDishesService, CanteenSettingsService],
})
export class CanteenAdminModule {}
