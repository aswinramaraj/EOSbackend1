import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FeePaymentService } from './fee-payment.service';
import { FeePaymentController } from './fee-payment.controller';
import { MeFeePaymentController } from './me-fee-payment.controller';

@Module({
  imports: [PrismaModule, NotificationsModule, AuditLogModule],
  controllers: [FeePaymentController, MeFeePaymentController],
  providers: [FeePaymentService],
  exports: [FeePaymentService],
})
export class FeePaymentModule {}
