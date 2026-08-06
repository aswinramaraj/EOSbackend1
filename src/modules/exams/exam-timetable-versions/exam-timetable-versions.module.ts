import { Module } from '@nestjs/common';
import { ExamTimetableVersionsService } from './exam-timetable-versions.service';
import { ExamTimetableVersionsController } from './exam-timetable-versions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExamTimetableVersionsController],
  providers: [ExamTimetableVersionsService],
})
export class ExamTimetableVersionsModule {}
