import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodAppraisalRequestsService } from './hod-appraisal-requests.service';
import { HodAppraisalRequestsController } from './hod-appraisal-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodAppraisalRequestsController],
  providers: [HodAppraisalRequestsService],
})
export class HodAppraisalRequestsModule {}
