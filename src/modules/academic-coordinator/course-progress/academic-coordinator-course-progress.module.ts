import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorCourseProgressController } from './academic-coordinator-course-progress.controller';
import { AcademicCoordinatorCourseProgressService } from './academic-coordinator-course-progress.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorCourseProgressController],
  providers: [AcademicCoordinatorCourseProgressService],
})
export class AcademicCoordinatorCourseProgressModule {}
