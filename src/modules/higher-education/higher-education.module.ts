import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TimetableModule } from 'src/modules/faculty/timetable/timetable.module';
import { HigherEducationDashboardController } from './higher-education-dashboard.controller';
import { HigherEducationDashboardService } from './higher-education-dashboard.service';
import { HigherEducationAspirantsController } from './higher-education-aspirants.controller';
import { HigherEducationAspirantsService } from './higher-education-aspirants.service';
import { HigherEducationApplicationsController } from './higher-education-applications.controller';
import { HigherEducationApplicationsService } from './higher-education-applications.service';
import { HigherEducationTestReadinessController } from './higher-education-test-readiness.controller';
import { HigherEducationTestReadinessService } from './higher-education-test-readiness.service';
import { HigherEducationUniversitiesController } from './higher-education-universities.controller';
import { HigherEducationUniversitiesService } from './higher-education-universities.service';
import { HigherEducationScholarshipsController } from './higher-education-scholarships.controller';
import { HigherEducationScholarshipsService } from './higher-education-scholarships.service';
import { HigherEducationReportsController } from './higher-education-reports.controller';
import { HigherEducationReportsService } from './higher-education-reports.service';
import { HigherEducationCalendarController } from './higher-education-calendar.controller';
import { HigherEducationCalendarService } from './higher-education-calendar.service';

@Module({
  imports: [PrismaModule, TimetableModule],
  controllers: [
    HigherEducationDashboardController,
    HigherEducationAspirantsController,
    HigherEducationApplicationsController,
    HigherEducationTestReadinessController,
    HigherEducationUniversitiesController,
    HigherEducationScholarshipsController,
    HigherEducationReportsController,
    HigherEducationCalendarController,
  ],
  providers: [
    HigherEducationDashboardService,
    HigherEducationAspirantsService,
    HigherEducationApplicationsService,
    HigherEducationTestReadinessService,
    HigherEducationUniversitiesService,
    HigherEducationScholarshipsService,
    HigherEducationReportsService,
    HigherEducationCalendarService,
  ],
})
export class HigherEducationModule {}
