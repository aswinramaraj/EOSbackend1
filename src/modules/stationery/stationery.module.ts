import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { StationeryService } from './stationery.service';
import { MeStationeryController } from './me-stationery.controller';
import { StationeryAdminController } from './stationery-admin.controller';

@Module({
  imports: [PrismaModule, WalletModule, StorageModule, NotificationsModule],
  controllers: [MeStationeryController, StationeryAdminController],
  providers: [StationeryService],
  // Exported so ParentsModule can reuse listMyOrders for a parent's
  // read-only order history view (it's already a full-history query, not
  // scoped to "today"/"active").
  exports: [StationeryService],
})
export class StationeryModule {}
