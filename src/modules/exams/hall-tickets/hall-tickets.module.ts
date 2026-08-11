import { Module } from '@nestjs/common';
import { HallTicketsService } from './hall-tickets.service';
import { HallTicketsController } from './hall-tickets.controller';
import { MeHallTicketsController } from './me-hall-tickets.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HallTicketsController, MeHallTicketsController],
  providers: [HallTicketsService],
})
export class HallTicketsModule {}
