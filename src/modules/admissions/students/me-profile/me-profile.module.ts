import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { StorageModule } from 'src/modules/storage/storage.module';
import { MeController } from './me-profile.controller';
import { MeProfileService } from './me-profile.service';
import { MeAttendanceService } from './me-attendance.service';
import { MeExamResultsService } from './me-exam-results.service';
import { MeLeavesService } from './me-leaves.service';
import { MeLeavesListService } from './me-leaves-list.service';
import { MeOdTeamsService } from './me-od-teams.service';
import { MeOdTeamsListService } from './me-od-teams-list.service';
import { MeOdRequestsService } from './me-od-requests.service';
import { MeOdRequestsListService } from './me-od-requests-list.service';
import { MeOdAttachmentsService } from './me-od-attachments.service';
import { MeHostelOutingsService } from './me-hostel-outings.service';
import { MeCampusOutingsService } from './me-campus-outings.service';
import { MeBonafideRequestsService } from './me-bonafide-requests.service';
import { MeProjectsService } from './me-projects.service';
import { MeFacultyDirectoryService } from './me-faculty-directory.service';
import { MeFeesService } from './me-fees.service';
import { MeExamScheduleService } from './me-exam-schedule.service';
import { MeHostelRoomService } from './me-hostel-room.service';
import { MeHostelComplaintsService } from './me-hostel-complaints.service';
import { MeMessFeedbackService } from './me-mess-feedback.service';
import { MeAcademicCalendarService } from './me-academic-calendar.service';
import { MeAcademicClearanceService } from './me-academic-clearance.service';

@Module({
  imports: [PrismaModule, NotificationsModule, StorageModule],
  controllers: [MeController],
  providers: [
    MeProfileService,
    MeAttendanceService,
    MeExamResultsService,
    MeLeavesService,
    MeLeavesListService,
    MeOdTeamsService,
    MeOdTeamsListService,
    MeOdRequestsService,
    MeOdRequestsListService,
    MeOdAttachmentsService,
    MeHostelOutingsService,
    MeCampusOutingsService,
    MeBonafideRequestsService,
    MeProjectsService,
    MeFacultyDirectoryService,
    MeFeesService,
    MeExamScheduleService,
    MeHostelRoomService,
    MeHostelComplaintsService,
    MeMessFeedbackService,
    MeAcademicCalendarService,
    MeAcademicClearanceService,
  ],
  exports: [
    MeAttendanceService,
    MeExamResultsService,
    MeFeesService,
    MeAcademicCalendarService,
  ],
})
export class MeProfileModule {}
