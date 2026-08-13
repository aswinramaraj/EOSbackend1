import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyOdRequestsModule } from 'src/modules/faculty/faculty-od-requests/faculty-od-requests.module';
import { HodEmployeeOdService } from './hod-employee-od.service';
import { HodEmployeeOdController } from './hod-employee-od.controller';

@Module({
  imports: [PrismaModule, FacultyOdRequestsModule],
  controllers: [HodEmployeeOdController],
  providers: [HodEmployeeOdService],
})
export class HodEmployeeOdModule {}
