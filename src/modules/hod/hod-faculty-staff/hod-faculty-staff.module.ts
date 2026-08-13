import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyAttendanceModule } from 'src/modules/faculty/faculty-attendance/faculty-attendance.module';
import { HodFacultyStaffService } from './hod-faculty-staff.service';
import { HodFacultyStaffController } from './hod-faculty-staff.controller';

@Module({
  imports: [PrismaModule, FacultyAttendanceModule],
  controllers: [HodFacultyStaffController],
  providers: [HodFacultyStaffService],
})
export class HodFacultyStaffModule {}
