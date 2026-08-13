import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyAttendanceModule } from 'src/modules/faculty/faculty-attendance/faculty-attendance.module';
import { HodReportsModule } from '../hod-reports/hod-reports.module';
import { HodDashboardService } from './hod-dashboard.service';
import { HodDashboardController } from './hod-dashboard.controller';

@Module({
  imports: [PrismaModule, FacultyAttendanceModule, HodReportsModule],
  controllers: [HodDashboardController],
  providers: [HodDashboardService],
})
export class HodDashboardModule {}
