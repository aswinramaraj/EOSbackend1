import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { VenuesService } from './venues.service';
import { VenueDashboardService } from './venue-dashboard.service';
import { VenuesController } from './venues.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [VenuesController],
  providers: [VenuesService, VenueDashboardService],
})
export class VenuesModule {}
