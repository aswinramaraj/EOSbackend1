import { Module } from '@nestjs/common';
import { HallTicketsService } from './hall-tickets.service';
import { HallTicketsController } from './hall-tickets.controller';
import { MeHallTicketsController } from './me-hall-tickets.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [HallTicketsController, MeHallTicketsController],
  providers: [HallTicketsService],
})
export class HallTicketsModule {}
