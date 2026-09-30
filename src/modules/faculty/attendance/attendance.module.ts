import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { MeClassesAttendanceController } from './me-classes-attendance.controller';
import { MeAttendanceReviewsController } from './me-attendance-reviews.controller';
import { MeStaffAttendanceService } from './me-staff-attendance.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AttendanceController,
    MeClassesAttendanceController,
    MeAttendanceReviewsController,
  ],
  providers: [AttendanceService, MeStaffAttendanceService],
})
export class AttendanceModule {}
