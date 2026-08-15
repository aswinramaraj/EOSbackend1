import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NightAttendanceService } from './night-attendance.service';
import { NightAttendanceController } from './night-attendance.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NightAttendanceController],
  providers: [NightAttendanceService],
})
export class NightAttendanceModule {}
