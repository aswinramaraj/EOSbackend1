import { Module } from '@nestjs/common';
import { HallTicketsService } from './hall-tickets.service';
import { HallTicketsController } from './hall-tickets.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HallTicketsController],
  providers: [HallTicketsService],
})
export class HallTicketsModule {}
