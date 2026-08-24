import { Module } from '@nestjs/common';
import { HallTicketsService } from './hall-tickets.service';
import { HallTicketsController } from './hall-tickets.controller';
import { HallTicketsSummaryController } from './hall-tickets-summary.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [HallTicketsController, HallTicketsSummaryController],
  providers: [HallTicketsService],
})
export class HallTicketsModule {}
