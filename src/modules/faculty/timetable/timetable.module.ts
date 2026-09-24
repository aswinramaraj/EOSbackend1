import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { TimetableService } from './timetable.service';
import { TimetablePeriodRequestsService } from './timetable-period-requests.service';
import { TimetableController } from './timetable.controller';
import { MeTimetableController } from './me-timetable.controller';
import { MeTimetableRequestsController } from './me-timetable-requests.controller';
import { MeClassesController } from './me-classes.controller';
import { MeCurrentSemesterController } from './me-current-semester.controller';
import { MeFacultyTimetableController } from './me-faculty-timetable.controller';
import { MeFacultyTimetableRosterController } from './me-faculty-timetable-roster.controller';
import { MeFacultyAcademicCalendarController } from './me-faculty-academic-calendar.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [
    TimetableController,
    MeTimetableController,
    MeTimetableRequestsController,
    MeClassesController,
    MeCurrentSemesterController,
    MeFacultyTimetableController,
    MeFacultyTimetableRosterController,
    MeFacultyAcademicCalendarController,
  ],
  providers: [TimetableService, TimetablePeriodRequestsService],
  exports: [TimetableService, TimetablePeriodRequestsService],
})
export class TimetableModule {}
