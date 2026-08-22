import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorAttendanceController } from './academic-coordinator-attendance.controller';
import { AcademicCoordinatorAttendanceService } from './academic-coordinator-attendance.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorAttendanceController],
  providers: [AcademicCoordinatorAttendanceService],
})
export class AcademicCoordinatorAttendanceModule {}
