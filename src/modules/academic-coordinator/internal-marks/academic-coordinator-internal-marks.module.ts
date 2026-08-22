import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorInternalMarksController } from './academic-coordinator-internal-marks.controller';
import { AcademicCoordinatorInternalMarksService } from './academic-coordinator-internal-marks.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorInternalMarksController],
  providers: [AcademicCoordinatorInternalMarksService],
})
export class AcademicCoordinatorInternalMarksModule {}
