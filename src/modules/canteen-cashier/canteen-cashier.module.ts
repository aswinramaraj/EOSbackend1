import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CanteenAdminModule } from 'src/modules/canteen-admin/canteen-admin.module';
import { CanteenQueueModule } from 'src/modules/canteen-queue/canteen-queue.module';
import { CanteenBillingController } from './canteen-billing.controller';
import { CanteenBillingService } from './canteen-billing.service';
import { CanteenCashierDishesController } from './canteen-cashier-dishes.controller';
import { CanteenOnlineOrdersController } from './canteen-online-orders.controller';
import { CanteenOnlineOrdersService } from './canteen-online-orders.service';

@Module({
  imports: [PrismaModule, CanteenAdminModule, CanteenQueueModule],
  controllers: [
    CanteenBillingController,
    CanteenCashierDishesController,
    CanteenOnlineOrdersController,
  ],
  providers: [CanteenBillingService, CanteenOnlineOrdersService],
})
export class CanteenCashierModule {}
