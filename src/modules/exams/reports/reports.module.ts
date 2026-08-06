import { Module } from '@nestjs/common';
import { ExamReportsService } from './reports.service';
import { ExamReportsController } from './reports.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ResultsModule } from 'src/modules/exams/results/results.module';

@Module({
  imports: [PrismaModule, ResultsModule],
  controllers: [ExamReportsController],
  providers: [ExamReportsService],
})
export class ExamReportsModule {}
