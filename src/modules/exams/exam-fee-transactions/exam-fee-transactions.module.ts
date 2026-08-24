import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ExamFeeTransactionsService } from './exam-fee-transactions.service';
import { ExamFeeTransactionsController } from './exam-fee-transactions.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ExamFeeTransactionsController],
  providers: [ExamFeeTransactionsService],
})
export class ExamFeeTransactionsModule {}
