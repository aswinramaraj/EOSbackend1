import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AttendanceEligibilityService } from './attendance-eligibility.service';
import { AttendanceEligibilityController } from './attendance-eligibility.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceEligibilityController],
  providers: [AttendanceEligibilityService],
})
export class AttendanceEligibilityModule {}
