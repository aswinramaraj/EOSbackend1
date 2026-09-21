import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { StationeryService } from './stationery.service';
import { MeStationeryController } from './me-stationery.controller';
import { StationeryAdminController } from './stationery-admin.controller';

@Module({
  imports: [PrismaModule, WalletModule, StorageModule],
  controllers: [MeStationeryController, StationeryAdminController],
  providers: [StationeryService],
})
export class StationeryModule {}
