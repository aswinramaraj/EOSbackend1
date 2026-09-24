import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CanteenAdminModule } from 'src/modules/canteen-admin/canteen-admin.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { CanteenQueueModule } from 'src/modules/canteen-queue/canteen-queue.module';
import { CanteenOrderingController } from './canteen-ordering.controller';
import { CanteenOrderingService } from './canteen-ordering.service';

@Module({
  imports: [PrismaModule, CanteenAdminModule, WalletModule, CanteenQueueModule],
  controllers: [CanteenOrderingController],
  providers: [CanteenOrderingService],
  // Exported so ParentsModule can reuse listOrdersForStudentUserId for a
  // parent's read-only order history view.
  exports: [CanteenOrderingService],
})
export class CanteenOrderingModule {}
