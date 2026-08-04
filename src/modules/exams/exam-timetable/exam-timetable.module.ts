// exam-timetable.module.ts
import { Module } from '@nestjs/common';
import { ExamTimetableService } from './exam-timetable.service';
import { ExamTimetableController } from './exam-timetable.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExamTimetableController],
  providers: [ExamTimetableService],
})
export class ExamTimetableModule {}
