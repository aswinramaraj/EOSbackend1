import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications/notifications.module';
import { VenuesService } from './venues.service';
import { VenuesController } from './venues.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [VenuesController],
  providers: [VenuesService],
})
export class VenuesModule {}
