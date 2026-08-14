import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MeFeePaymentController } from './me-fee-payment.controller';
import { MeFeePaymentService } from './me-fee-payment.service';

@Module({
  imports: [PrismaModule],
  controllers: [MeFeePaymentController],
  providers: [MeFeePaymentService],
})
export class MeFeePaymentModule {}
