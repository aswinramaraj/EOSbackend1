import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AppraisalModule } from 'src/modules/faculty/appraisal/appraisal.module';
import { HodEmployeeAppraisalService } from './hod-employee-appraisal.service';
import { HodEmployeeAppraisalController } from './hod-employee-appraisal.controller';

@Module({
  imports: [PrismaModule, AppraisalModule],
  controllers: [HodEmployeeAppraisalController],
  providers: [HodEmployeeAppraisalService],
})
export class HodEmployeeAppraisalModule {}
