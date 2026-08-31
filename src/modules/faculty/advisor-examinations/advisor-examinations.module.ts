import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ExamResultsGridModule } from 'src/modules/academic-structure/exam-results/exam-results-grid.module';
import { AdvisorExaminationsController } from './advisor-examinations.controller';
import { AdvisorExaminationsService } from './advisor-examinations.service';

@Module({
  imports: [PrismaModule, ExamResultsGridModule],
  controllers: [AdvisorExaminationsController],
  providers: [AdvisorExaminationsService],
})
export class AdvisorExaminationsModule {}
