import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ExamResultsGridService } from './exam-results-grid.service';

@Module({
  imports: [PrismaModule],
  providers: [ExamResultsGridService],
  exports: [ExamResultsGridService],
})
export class ExamResultsGridModule {}
