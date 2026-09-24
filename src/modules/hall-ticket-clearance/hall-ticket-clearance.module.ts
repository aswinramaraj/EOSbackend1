import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HallTicketClearanceService } from './hall-ticket-clearance.service';
import { HallTicketClearanceController } from './hall-ticket-clearance.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HallTicketClearanceController],
  providers: [HallTicketClearanceService],
  exports: [HallTicketClearanceService],
})
export class HallTicketClearanceModule {}
