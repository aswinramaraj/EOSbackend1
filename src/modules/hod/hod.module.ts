import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyAttendanceModule } from 'src/modules/faculty/faculty-attendance/faculty-attendance.module';
import { AnnouncementsModule } from 'src/modules/announcements/announcements/announcements.module';
import { AppraisalModule } from 'src/modules/faculty/appraisal/appraisal.module';
import { FacultyLeavesModule } from 'src/modules/faculty/faculty-leaves/faculty-leaves.module';
import { FacultyOdRequestsModule } from 'src/modules/faculty/faculty-od-requests/faculty-od-requests.module';
import { FacultyOdModule } from 'src/modules/faculty/faculty-od/faculty-od.module';
import { HrQueriesModule } from 'src/modules/faculty/hr-queries/hr-queries.module';
import { NoDueModule } from 'src/modules/faculty/no-due/no-due.module';
import { PayslipRequestsModule } from 'src/modules/faculty/payslip-requests/payslip-requests.module';
import { PurchaseRequestsModule } from 'src/modules/procurement/purchase-requests/purchase-requests.module';
import { ServiceRequestsModule } from 'src/modules/procurement/service-requests/service-requests.module';
import { TimetableModule } from 'src/modules/faculty/timetable/timetable.module';
import { LibrarySettingsModule } from 'src/modules/library/settings/settings.module';

import { HodController } from './hod.controller';
import { HodService } from './hod.service';
import { HodReportsService } from './hod-reports.service';

import { HodDepartmentController } from './hod-department.controller';
import { HodClassRecordsService } from './hod-class-records.service';
import { HodFacultyStaffService } from './hod-faculty-staff.service';
import { HodExaminationsService } from './hod-examinations.service';

import { HodDepartment2Controller } from './hod-department-2.controller';
import { HodPlacementsService } from './hod-placements.service';
import { HodHigherEducationService } from './hod-higher-education.service';
import { HodEdcService } from './hod-edc.service';
import { HodAssignFacultyService } from './hod-assign-faculty.service';
import { HodTimetableService } from './hod-timetable.service';
import { HodAcademicCalendarService } from './hod-academic-calendar.service';

import { HodApprovalsController } from './hod-approvals.controller';
import { HodApprovalsService } from './hod-approvals.service';
import { HodNoDueController } from './hod-no-due.controller';
import { HodNoDueService } from './hod-no-due.service';
import { HodSopPopController } from './hod-sop-pop.controller';
import { HodSopPopService } from './hod-sop-pop.service';
import { HodAppraisalController } from './hod-appraisal.controller';
import { HodAppraisalService } from './hod-appraisal.service';

import { HodMyClassController } from './hod-my-class.controller';
import { HodMyClassService } from './hod-my-class.service';

import { HodEmployeeController } from './hod-employee.controller';
import { HodEmployeeService } from './hod-employee.service';

import { HodStudentProfileService } from './hod-student-profile.service';

@Module({
  imports: [
    PrismaModule,
    FacultyAttendanceModule,
    AnnouncementsModule,
    AppraisalModule,
    FacultyLeavesModule,
    FacultyOdRequestsModule,
    FacultyOdModule,
    HrQueriesModule,
    NoDueModule,
    PayslipRequestsModule,
    PurchaseRequestsModule,
    ServiceRequestsModule,
    TimetableModule,
    LibrarySettingsModule,
  ],
  controllers: [
    HodController,
    HodDepartmentController,
    HodDepartment2Controller,
    HodApprovalsController,
    HodNoDueController,
    HodSopPopController,
    HodAppraisalController,
    HodMyClassController,
    HodEmployeeController,
  ],
  providers: [
    HodService,
    HodReportsService,
    HodClassRecordsService,
    HodFacultyStaffService,
    HodExaminationsService,
    HodPlacementsService,
    HodHigherEducationService,
    HodEdcService,
    HodAssignFacultyService,
    HodTimetableService,
    HodAcademicCalendarService,
    HodApprovalsService,
    HodNoDueService,
    HodSopPopService,
    HodAppraisalService,
    HodMyClassService,
    HodEmployeeService,
    HodStudentProfileService,
  ],
})
export class HodModule {}
