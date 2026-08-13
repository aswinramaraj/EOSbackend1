import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AttendanceModule } from 'src/modules/faculty/attendance/attendance.module';
import { HodMyClassAttendanceService } from './hod-my-class-attendance.service';
import { HodMyClassAttendanceController } from './hod-my-class-attendance.controller';

@Module({
  imports: [PrismaModule, AttendanceModule],
  controllers: [HodMyClassAttendanceController],
  providers: [HodMyClassAttendanceService],
})
export class HodMyClassAttendanceModule {}
