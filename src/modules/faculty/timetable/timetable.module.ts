import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TimetableService } from './timetable.service';
import { TimetableController } from './timetable.controller';
import { MeTimetableController } from './me-timetable.controller';
import { MeClassesController } from './me-classes.controller';
import { MeCurrentSemesterController } from './me-current-semester.controller';
import { MeFacultyTimetableController } from './me-faculty-timetable.controller';
import { MeFacultyTimetableRosterController } from './me-faculty-timetable-roster.controller';
import { MeFacultyAcademicCalendarController } from './me-faculty-academic-calendar.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    TimetableController,
    MeTimetableController,
    MeClassesController,
    MeCurrentSemesterController,
    MeFacultyTimetableController,
    MeFacultyTimetableRosterController,
    MeFacultyAcademicCalendarController,
  ],
  providers: [TimetableService],
})
export class TimetableModule {}
