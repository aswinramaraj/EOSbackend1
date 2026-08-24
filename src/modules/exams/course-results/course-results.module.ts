import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CourseResultsService } from './course-results.service';
import { CourseResultsController } from './course-results.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CourseResultsController],
  providers: [CourseResultsService],
})
export class CourseResultsModule {}
