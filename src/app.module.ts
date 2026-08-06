import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';

import { AcademicCalendarModule } from './modules/academic-structure/academic-calendar/academic-calendar.module';
import { AcademicCalendarEventsModule } from './modules/academic-structure/academic-calendar-events/academic-calendar-events.module';
import { BatchesModule } from './modules/academic-structure/batches/batches.module';
import { ClassesModule } from './modules/academic-structure/classes/classes.module';
import { CoursesModule } from './modules/academic-structure/courses/courses.module';
import { DepartmentsModule } from './modules/academic-structure/departments/departments.module';
import { SubjectsModule } from './modules/academic-structure/subjects/subjects.module';

import { BonafideModule } from './modules/admissions/bonafide/bonafide.module';
import { BonafideReasonsModule } from './modules/admissions/bonafide-reasons/bonafide-reasons.module';
import { CertificatesModule } from './modules/admissions/certificates/certificates.module';
import { OdModule } from './modules/admissions/od/od.module';
import { SoaApplicationsModule } from './modules/admissions/soa-applications/soa-applications.module';
import { StudentLeavesModule } from './modules/admissions/student-leaves/student-leaves.module';
import { StudentsModule } from './modules/admissions/students/students.module';
import { MeProfileModule } from './modules/admissions/students/me-profile/me-profile.module';

import { AnnouncementsModule } from './modules/announcements/announcements/announcements.module';

import { ExamsModule } from './modules/exams/exams/exams.module';
import { ExamSubjectMappingModule } from './modules/exams/exam-subject-mapping/exam-subject-mapping.module';
import { ExamTimetableModule } from './modules/exams/exam-timetable/exam-timetable.module';
import { ExamTypesModule } from './modules/exams/exam-types/exam-types.module';
import { HallPlansModule } from './modules/exams/hall-plans/hall-plans.module';
import { HallTicketsModule } from './modules/exams/hall-tickets/hall-tickets.module';
import { InvigilationModule } from './modules/exams/invigilation/invigilation.module';
import { MarksModule } from './modules/exams/marks/marks.module';
import { MarksheetsModule } from './modules/exams/marksheets/marksheets.module';
import { ResultsModule } from './modules/exams/results/results.module';
import { RevaluationModule } from './modules/exams/revaluation/revaluation.module';
import { SeatingArrangementsModule } from './modules/exams/seating-arrangements/seating-arrangements.module';

import { AppraisalModule } from './modules/faculty/appraisal/appraisal.module';
import { AssignmentsModule } from './modules/faculty/assignments/assignments.module';
import { AttendanceModule } from './modules/faculty/attendance/attendance.module';
import { ClassMentorsModule } from './modules/faculty/class-mentors/class-mentors.module';
import { ExamMarksModule } from './modules/faculty/exam-marks/exam-marks.module';
import { FacultyLeavesModule } from './modules/faculty/faculty-leaves/faculty-leaves.module';
import { FacultyMappingModule } from './modules/faculty/faculty-mapping/faculty-mapping.module';
import { FacultyModule } from './modules/faculty/faculty/faculty.module';
import { HolidaySlotsModule } from './modules/faculty/holiday-slots/holiday-slots.module';
import { HrPayrollModule } from './modules/faculty/hr-payroll/hr-payroll.module';
import { LessonPlansModule } from './modules/faculty/lesson-plans/lesson-plans.module';
import { LmsNotesModule } from './modules/faculty/lms-notes/lms-notes.module';
import { MediaRequestsModule } from './modules/faculty/media-requests/media-requests.module';
import { PayslipRequestsModule } from './modules/faculty/payslip-requests/payslip-requests.module';
import { SalaryDivisionsModule } from './modules/faculty/salary-divisions/salary-divisions.module';
import { StudentAssignmentStatusModule } from './modules/faculty/student-assignment-status/student-assignment-status.module';
import { TimetableModule } from './modules/faculty/timetable/timetable.module';

import { DemandModule } from './modules/fees-billing/demand/demand.module';
import { EducationLoanDdModule } from './modules/fees-billing/education-loan-dd/education-loan-dd.module';
import { FeeConcessionModule } from './modules/fees-billing/fee-concessions/fee-concession.module';
import { FeePaymentModule } from './modules/fees-billing/fee-payments/fee-payment.module';
import { FinanceOverviewModule } from './modules/fees-billing/finance-overview/finance-overview.module';
import { FeeStructureModule } from './modules/fees-billing/fee-structure/fee-structure.module';
import { FeeStructureItemModule } from './modules/fees-billing/fee-structure-items/fee-structure-item.module';
import { GateLedgerModule } from './modules/fees-billing/gate-ledger/gate-ledger.module';
import { HostelRoomModule } from './modules/fees-billing/hostel-rooms/hostel-room.module';
import { HostelRoomTypeModule } from './modules/fees-billing/hostel-room-types/hostel-room-type.module';
import { QuotaModule } from './modules/fees-billing/quota/quota.module';
import { StudentFeeDemandMappingModule } from './modules/fees-billing/student-fee-demand-mapping/student-fee-demand-mapping.module';
import { TransportRouteModule } from './modules/fees-billing/transport-routes/transport-route.module';
import { TransportStageModule } from './modules/fees-billing/transport-stages/transport-stage.module';

import { BookCategoriesModule } from './modules/library/book-categories/book-categories.module';
import { BooksModule } from './modules/library/books/books.module';
import { BorrowRecordsModule } from './modules/library/borrow-records/borrow-records.module';
import { EResourcesModule } from './modules/library/e-resources/e-resources.module';
import { StudentLookupModule } from './modules/library/student-lookup/student-lookup.module';
import { LibraryDashboardModule } from './modules/library/dashboard/dashboard.module';
import { MembersModule } from './modules/library/members/members.module';
import { LibrarySettingsModule } from './modules/library/settings/settings.module';
import { RacksModule } from './modules/library/racks/racks.module';
import { LibraryReportsModule } from './modules/library/reports/reports.module';

import { CompaniesModule } from './modules/placement/companies/companies.module';
import { DrivesModule } from './modules/placement/drives/drives.module';
import { StudentProfilesModule } from './modules/placement/student-profiles/student-profiles.module';

import { GrnModule } from './modules/procurement/grn/grn.module';
import { PurchaseIndentsModule } from './modules/procurement/purchase-indents/purchase-indents.module';
import { PurchaseOrderProposalsModule } from './modules/procurement/purchase-order-proposals/purchase-order-proposals.module';
import { PurchaseOrdersModule } from './modules/procurement/purchase-orders/purchase-orders.module';
import { ServiceIndentsModule } from './modules/procurement/service-indents/service-indents.module';
import { ServiceOrderProposalsModule } from './modules/procurement/service-order-proposals/service-order-proposals.module';
import { ServiceOrdersModule } from './modules/procurement/service-orders/service-orders.module';
import { VendorQuotationsModule } from './modules/procurement/vendor-quotations/vendor-quotations.module';
import { VendorsModule } from './modules/procurement/vendors/vendors.module';

import { VenuesModule } from './modules/venues/venues/venues.module';
import { NotificationsModule } from './modules/notifications/notifications/notifications.module';
import { FeedbackModule } from './modules/feedback/feedback/feedback.module';
import { HallTicketClearanceModule } from './modules/hall-ticket-clearance/hall-ticket-clearance.module';

import { AlumniModule } from './modules/alumni/alumni.module';
import { AchievementsModule } from './modules/achievements/achievements.module';

import { HostelsModule } from './modules/hostel/hostels/hostels.module';
import { ResidentsModule } from './modules/hostel/residents/residents.module';
import { OutingsModule } from './modules/hostel/outings/outings.module';
import { GateLogModule } from './modules/hostel/gate-log/gate-log.module';
import { HostelDashboardModule } from './modules/hostel/dashboard/dashboard.module';
import { ComplaintsModule } from './modules/hostel/complaints/complaints.module';
import { MessFeedbackModule } from './modules/hostel/mess-feedback/mess-feedback.module';
import { HostelFeesModule } from './modules/hostel/fees/fees.module';
import { HostelSettingsModule } from './modules/hostel/settings/settings.module';
import { HostelReportsModule } from './modules/hostel/reports/reports.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // Used by DrivesModule to auto-reveal undisclosed companies and post
    // day-before drive announcements.
    ScheduleModule.forRoot(),

    AuthModule,

    AcademicCalendarModule,
    AcademicCalendarEventsModule,
    BatchesModule,
    ClassesModule,
    CoursesModule,
    DepartmentsModule,
    SubjectsModule,

    BonafideModule,
    BonafideReasonsModule,
    CertificatesModule,
    OdModule,
    SoaApplicationsModule,
    StudentLeavesModule,
    StudentsModule,
    MeProfileModule,

    AnnouncementsModule,

    ExamsModule,
    ExamSubjectMappingModule,
    ExamTimetableModule,
    ExamTypesModule,
    HallPlansModule,
    HallTicketsModule,
    InvigilationModule,
    MarksModule,
    MarksheetsModule,
    ResultsModule,
    RevaluationModule,
    SeatingArrangementsModule,

    AppraisalModule,
    AssignmentsModule,
    AttendanceModule,
    ClassMentorsModule,
    ExamMarksModule,
    FacultyLeavesModule,
    FacultyMappingModule,
    FacultyModule,
    HolidaySlotsModule,
    HrPayrollModule,
    LessonPlansModule,
    LmsNotesModule,
    MediaRequestsModule,
    PayslipRequestsModule,
    SalaryDivisionsModule,
    StudentAssignmentStatusModule,
    TimetableModule,

    DemandModule,
    EducationLoanDdModule,
    FeeConcessionModule,
    FeePaymentModule,
    FinanceOverviewModule,
    FeeStructureModule,
    FeeStructureItemModule,
    GateLedgerModule,
    HostelRoomModule,
    HostelRoomTypeModule,
    QuotaModule,
    StudentFeeDemandMappingModule,
    TransportRouteModule,
    TransportStageModule,

    BookCategoriesModule,
    BooksModule,
    BorrowRecordsModule,
    EResourcesModule,
    StudentLookupModule,
    LibraryDashboardModule,
    MembersModule,
    LibrarySettingsModule,
    RacksModule,
    LibraryReportsModule,

    CompaniesModule,
    DrivesModule,
    StudentProfilesModule,

    GrnModule,
    PurchaseIndentsModule,
    PurchaseOrderProposalsModule,
    PurchaseOrdersModule,
    ServiceIndentsModule,
    ServiceOrderProposalsModule,
    ServiceOrdersModule,
    VendorQuotationsModule,
    VendorsModule,

    VenuesModule,
    NotificationsModule,
    FeedbackModule,
    HallTicketClearanceModule,

    AlumniModule,
    AchievementsModule,

    HostelsModule,
    ResidentsModule,
    OutingsModule,
    GateLogModule,
    HostelDashboardModule,
    ComplaintsModule,
    MessFeedbackModule,
    HostelFeesModule,
    HostelSettingsModule,
    HostelReportsModule,
  ],

  controllers: [AppController],

  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
