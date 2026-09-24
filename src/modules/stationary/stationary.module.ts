import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { StationaryService } from './stationary.service';
import { StationaryController } from './stationary.controller';
import { StationaryVendorController } from './stationary-vendor.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [StationaryController, StationaryVendorController],
  providers: [StationaryService],
  // Exported so ParentsModule can reuse listMyRequests for a parent's
  // read-only Copy Center request history view.
  exports: [StationaryService],
})
export class StationaryModule {}
