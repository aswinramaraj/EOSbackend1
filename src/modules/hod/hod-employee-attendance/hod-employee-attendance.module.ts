import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyAttendanceModule } from 'src/modules/faculty/faculty-attendance/faculty-attendance.module';
import { HodEmployeeAttendanceService } from './hod-employee-attendance.service';
import { HodEmployeeAttendanceController } from './hod-employee-attendance.controller';

@Module({
  imports: [PrismaModule, FacultyAttendanceModule],
  controllers: [HodEmployeeAttendanceController],
  providers: [HodEmployeeAttendanceService],
})
export class HodEmployeeAttendanceModule {}
