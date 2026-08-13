import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OdHodApprovalsModule } from 'src/modules/admissions/od-hod-approvals/od-hod-approvals.module';
import { FacultyOdRequestsModule } from 'src/modules/faculty/faculty-od-requests/faculty-od-requests.module';
import { HodOdRequestsService } from './hod-od-requests.service';
import { HodOdRequestsController } from './hod-od-requests.controller';

@Module({
  imports: [PrismaModule, OdHodApprovalsModule, FacultyOdRequestsModule],
  controllers: [HodOdRequestsController],
  providers: [HodOdRequestsService],
})
export class HodOdRequestsModule {}
