import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AppraisalCriteriaService } from './appraisal-criteria.service';
import { AppraisalCriteriaController } from './appraisal-criteria.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AppraisalCriteriaController],
  providers: [AppraisalCriteriaService],
})
export class AppraisalCriteriaModule {}
