import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyAttendanceService } from './faculty-attendance.service';
import { FacultyAttendanceController } from './faculty-attendance.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyAttendanceController],
  providers: [FacultyAttendanceService],
})
export class FacultyAttendanceModule {}
