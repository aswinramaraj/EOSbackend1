// exam-timetable.module.ts
import { Module } from '@nestjs/common';
import { ExamTimetableService } from './exam-timetable.service';
import { ExamTimetableController } from './exam-timetable.controller';
import { ExamTimetableVersionsService } from './exam-timetable-versions.service';
import { ExamTimetableVersionsController } from './exam-timetable-versions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExamTimetableController, ExamTimetableVersionsController],
  providers: [ExamTimetableService, ExamTimetableVersionsService],
})
export class ExamTimetableModule {}
