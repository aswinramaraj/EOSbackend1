import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeAttendanceService } from 'src/modules/admissions/students/me-profile/me-attendance.service';
import { MeExamResultsService } from 'src/modules/admissions/students/me-profile/me-exam-results.service';
import { MeFeesService } from 'src/modules/admissions/students/me-profile/me-fees.service';
import { MeAcademicCalendarService } from 'src/modules/admissions/students/me-profile/me-academic-calendar.service';
import { GetAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-attendance.dto';
import { GetExamResultsDto } from 'src/modules/admissions/students/me-profile/dto/get-exam-results.dto';
import { TimetableService } from 'src/modules/faculty/timetable/timetable.service';
import { GetMyTimetableQueryDto } from 'src/modules/faculty/timetable/dto/get-my-timetable-query.dto';
import { DrivesService } from 'src/modules/placement/drives/drives.service';
import { FeePaymentService } from 'src/modules/fees-billing/fee-payments/fee-payment.service';
import { CreateFeePaymentOrderDto } from 'src/modules/fees-billing/fee-payments/dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from 'src/modules/fees-billing/fee-payments/dto/verify-fee-payment.dto';
import { CanteenOrderingService } from 'src/modules/canteen-ordering/canteen-ordering.service';
import { BorrowRecordsService } from 'src/modules/library/borrow-records/borrow-records.service';
import { GetMyBorrowRecordsDto } from 'src/modules/library/borrow-records/dto/get-my-borrow-records.dto';
import { MedicalAppointmentsService } from 'src/modules/medical-centre/medical-appointments.service';
import { MeExamScheduleService } from 'src/modules/admissions/students/me-profile/me-exam-schedule.service';
import { MeCareerPathService } from 'src/modules/admissions/students/me-profile/me-career-path.service';
import { MeLeavesListService } from 'src/modules/admissions/students/me-profile/me-leaves-list.service';
import { GetLeavesDto } from 'src/modules/admissions/students/me-profile/dto/get-leaves.dto';
import { MeOdRequestsListService } from 'src/modules/admissions/students/me-profile/me-od-requests-list.service';
import { GetOdRequestsDto } from 'src/modules/admissions/students/me-profile/dto/get-od-requests.dto';
import { MeBonafideRequestsService } from 'src/modules/admissions/students/me-profile/me-bonafide-requests.service';
import { GetBonafideRequestsDto } from 'src/modules/admissions/students/me-profile/dto/get-bonafide-requests.dto';
import { MeHostelRoomService } from 'src/modules/admissions/students/me-profile/me-hostel-room.service';
import { MeHostelOutingsService } from 'src/modules/admissions/students/me-profile/me-hostel-outings.service';
import { GetHostelOutingsDto } from 'src/modules/admissions/students/me-profile/dto/get-hostel-outings.dto';
import { MeCampusOutingsService } from 'src/modules/admissions/students/me-profile/me-campus-outings.service';
import { GetCampusOutingsDto } from 'src/modules/admissions/students/me-profile/dto/get-campus-outings.dto';
import { HallTicketClearanceService } from 'src/modules/hall-ticket-clearance/hall-ticket-clearance.service';
import { ListClearanceQueryDto } from 'src/modules/hall-ticket-clearance/dto/list-clearance-query.dto';
import { LmsService } from 'src/modules/lms/lms.service';
import { StudentHigherEducationService } from 'src/modules/student-higher-education/student-higher-education.service';
import { StudentEntrepreneurshipService } from 'src/modules/student-entrepreneurship/student-entrepreneurship.service';

interface ChildRow {
  students: {
    id: number;
    student_id_no: string;
    roll_no: string | null;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
    classes: {
      section: string;
      current_semester: number | null;
      departments: { id: number; name: string; code: string } | null;
    } | null;
  };
  relationship: string;
}

function resolveStudentName(student: ChildRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toChildResponse(row: ChildRow) {
  const { students: student, relationship } = row;
  return {
    id: student.id,
    name: resolveStudentName(student),
    student_id_no: student.student_id_no,
    roll_no: student.roll_no,
    relationship,
    section: student.classes?.section ?? null,
    semester: student.classes?.current_semester ?? null,
    department: student.classes?.departments ?? null,
  };
}

/**
 * Parent self-service: attendance/performance/fees for a parent's own
 * linked child (children), never a client-supplied student_id trusted
 * without checking parent_student_mapping first - same
 * findFirst/findMany(where:{parent_user_id}) idiom already used by
 * AttendanceService and ClassMentorsService for parent-scoped access.
 */
@Injectable()
export class ParentsService {
  private readonly logger = new Logger(ParentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meAttendanceService: MeAttendanceService,
    private readonly meExamResultsService: MeExamResultsService,
    private readonly meFeesService: MeFeesService,
    private readonly meAcademicCalendarService: MeAcademicCalendarService,
    private readonly timetableService: TimetableService,
    private readonly drivesService: DrivesService,
    private readonly feePaymentService: FeePaymentService,
    private readonly canteenOrderingService: CanteenOrderingService,
    private readonly borrowRecordsService: BorrowRecordsService,
    private readonly medicalAppointmentsService: MedicalAppointmentsService,
    private readonly meExamScheduleService: MeExamScheduleService,
    private readonly meCareerPathService: MeCareerPathService,
    private readonly meLeavesListService: MeLeavesListService,
    private readonly meOdRequestsListService: MeOdRequestsListService,
    private readonly meBonafideRequestsService: MeBonafideRequestsService,
    private readonly meHostelRoomService: MeHostelRoomService,
    private readonly meHostelOutingsService: MeHostelOutingsService,
    private readonly meCampusOutingsService: MeCampusOutingsService,
    private readonly hallTicketClearanceService: HallTicketClearanceService,
    private readonly lmsService: LmsService,
    private readonly studentHigherEducationService: StudentHigherEducationService,
    private readonly studentEntrepreneurshipService: StudentEntrepreneurshipService,
  ) {}

  /** GET /me/children (Parent only). One row per linked child, however many there are. */
  async listChildren(parentUserId: number) {
    const rows = await this.prisma.parent_student_mapping.findMany({
      where: { parent_user_id: parentUserId },
      select: {
        relationship: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            roll_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            classes: {
              select: {
                section: true,
                current_semester: true,
                departments: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
      orderBy: { student_id: 'asc' },
    });

    return rows.map(toChildResponse);
  }

  /** GET /me/children/:studentId/attendance (Parent only). */
  async getChildAttendance(
    parentUserId: number,
    studentId: number,
    dto: GetAttendanceDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meAttendanceService.getAttendanceForStudentId(studentId, dto);
  }

  /** GET /me/children/:studentId/performance (Parent only). */
  async getChildPerformance(
    parentUserId: number,
    studentId: number,
    dto: GetExamResultsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meExamResultsService.getExamResultsForStudentId(studentId, dto);
  }

  /** GET /me/children/:studentId/fees (Parent only). */
  async getChildFees(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meFeesService.getFeesForStudentId(studentId);
  }

  /** POST /me/children/:studentId/fees/demands/:id/payment-order (Parent only, own child). */
  async payChildFeeDemand(
    parentUserId: number,
    studentId: number,
    demandMappingId: number,
    dto: CreateFeePaymentOrderDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.feePaymentService.createGatewayOrderForChild(
      parentUserId,
      studentId,
      demandMappingId,
      dto,
    );
  }

  /**
   * POST /me/children/:studentId/fees/payment-order/verify (Parent only,
   * own child). Verification itself doesn't need studentId at all (see
   * FeePaymentService.verifyGatewayPayment's doc comment - it's keyed by
   * order ownership, not role/student) - the assertOwnChild check here is
   * purely defense in depth, matching every other parent-on-behalf-of-child
   * route's shape.
   */
  async verifyChildFeePayment(
    parentUserId: number,
    studentId: number,
    dto: VerifyFeePaymentDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.feePaymentService.verifyGatewayPayment(parentUserId, dto);
  }

  /** GET /me/children/:studentId/timetable (Parent only). */
  async getChildTimetable(
    parentUserId: number,
    studentId: number,
    dto: GetMyTimetableQueryDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.timetableService.getTimetableForStudentId(studentId, dto);
  }

  /** GET /me/children/:studentId/academic-calendar (Parent only). */
  async getChildAcademicCalendar(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meAcademicCalendarService.getAcademicCalendarForStudentId(
      studentId,
    );
  }

  /** GET /me/children/:studentId/upcoming-drives (Parent only). */
  async getChildUpcomingDrives(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.drivesService.getUpcomingForStudentId(studentId);
  }

  /** GET /me/children/:studentId/placement-history (Parent only). */
  async getChildPlacementHistory(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.drivesService.getPlacementHistoryForStudentId(studentId);
  }

  /**
   * GET /me/children/:studentId/canteen-orders (Parent only). Reuses
   * CanteenOrderingService.listMyOrders as-is — canteen orders have no
   * student_id column at all (only placed_by_user_id), so there's no
   * "ForStudentId" variant to add, just the child's own user_id. Same scope
   * as the student's own view: today's orders plus anything still active
   * from before midnight, not full lifetime history (see that method's own
   * doc comment) - the frontend labels this "Recent orders" accordingly.
   */
  async getChildCanteenOrders(parentUserId: number, studentId: number) {
    const childUserId = await this.assertOwnChildUserId(
      parentUserId,
      studentId,
    );
    return this.canteenOrderingService.listMyOrders(childUserId);
  }

  /** GET /me/children/:studentId/library-records (Parent only). */
  async getChildLibraryRecords(
    parentUserId: number,
    studentId: number,
    dto: GetMyBorrowRecordsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.borrowRecordsService.findBorrowRecordsForStudentId(
      studentId,
      dto,
    );
  }

  /**
   * GET /me/children/:studentId/medical-appointments (Parent only). History
   * only - booking an appointment on a child's behalf stays blocked (see
   * MedicalAppointmentsController's BOOKING_ROLES), same as every other
   * read-only child route this service exposes.
   */
  async getChildMedicalAppointments(parentUserId: number, studentId: number) {
    const childUserId = await this.assertOwnChildUserId(
      parentUserId,
      studentId,
    );
    return this.medicalAppointmentsService.listMine(childUserId);
  }

  /** GET /me/children/:studentId/exam-schedule (Parent only, own child). */
  async getChildExamSchedule(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meExamScheduleService.getExamScheduleForStudentId(studentId);
  }

  /**
   * GET /me/children/:studentId/career-path (Parent only, own child) — used
   * to gate the same career-path-tagged nav items (Placements/My
   * Venture/Higher Studies) the student's own sidebar gates, but by the
   * child's declared path instead of the caller's.
   */
  async getChildCareerPath(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meCareerPathService.getCareerPathForStudentId(studentId);
  }

  /** GET /me/children/:studentId/leaves (Parent only, own child). Read-only: no create. */
  async getChildLeaves(
    parentUserId: number,
    studentId: number,
    dto: GetLeavesDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meLeavesListService.getLeavesForStudentId(studentId, dto);
  }

  /**
   * GET /me/children/:studentId/od-requests (Parent only, own child). Read-only
   * status list — no team creation/join/leave, no full team roster (see
   * MeOdRequestsListService.getOdRequestsForStudentId's own doc comment).
   */
  async getChildOdRequests(
    parentUserId: number,
    studentId: number,
    dto: GetOdRequestsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meOdRequestsListService.getOdRequestsForStudentId(
      studentId,
      dto,
    );
  }

  /** GET /me/children/:studentId/bonafide-requests (Parent only, own child). Read-only: no create. */
  async getChildBonafideRequests(
    parentUserId: number,
    studentId: number,
    dto: GetBonafideRequestsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meBonafideRequestsService.getBonafideRequestsForStudentId(
      studentId,
      dto,
    );
  }

  /** GET /me/children/:studentId/clearance-requests (Parent only, own child) — the "No-due" tab. Read-only: no create. */
  async getChildClearanceRequests(
    parentUserId: number,
    studentId: number,
    dto: ListClearanceQueryDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.hallTicketClearanceService.findForStudentId(studentId, dto);
  }

  /** GET /me/children/:studentId/hostel-room (Parent only, own child). */
  async getChildHostelRoom(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meHostelRoomService.getHostelRoomForStudentId(studentId);
  }

  /** GET /me/children/:studentId/hostel-outings (Parent only, own child). Read-only: no create. */
  async getChildHostelOutings(
    parentUserId: number,
    studentId: number,
    dto: GetHostelOutingsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meHostelOutingsService.getHostelOutingsForStudentId(
      studentId,
      dto,
    );
  }

  /**
   * GET /me/children/:studentId/campus-outings (Parent only, own child) —
   * the "In / out request" tab. Read-only: no create. Not gated by hosteller
   * status (unlike hostel-outings above) - MeCampusOutingsService's own doc
   * comment confirms this gate pass is open to every student regardless of
   * residency, despite the student nav item's misleading hostellerOnly flag.
   */
  async getChildCampusOutings(
    parentUserId: number,
    studentId: number,
    dto: GetCampusOutingsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meCampusOutingsService.getCampusOutingsForStudentId(
      studentId,
      dto,
    );
  }

  /** GET /me/children/:studentId/higher-education (Parent only, own child) — staff-entered, read-only for the student too. */
  async getChildHigherEducation(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.studentHigherEducationService.findForStudentId(studentId);
  }

  /** GET /me/children/:studentId/entrepreneurship (Parent only, own child) — "My Venture", staff-entered, read-only for the student too. */
  async getChildEntrepreneurship(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.studentEntrepreneurshipService.findForStudentId(studentId);
  }

  /** GET /me/children/:studentId/lms/subjects (Parent only, own child). */
  async getChildLmsSubjects(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.lmsService.getSubjectsForStudentId(studentId);
  }

  /** GET /me/children/:studentId/lms/subjects/:subjectId/tasks (Parent only, own child). Read-only: no submit. */
  async getChildLmsTasks(
    parentUserId: number,
    studentId: number,
    subjectId: number,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.lmsService.getTasksForStudentId(subjectId, studentId);
  }

  private async assertOwnChild(parentUserId: number, studentId: number) {
    const mapping = await this.prisma.parent_student_mapping.findFirst({
      where: { parent_user_id: parentUserId, student_id: studentId },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: "You may only view your own children's records",
        errorCode: 'NOT_THIS_PARENT',
      });
    }
  }

  /** Same ownership check as assertOwnChild, but also returns the child's own user_id — needed by the canteen/medical wrappers above, which are keyed by user_id rather than student_id. */
  private async assertOwnChildUserId(
    parentUserId: number,
    studentId: number,
  ): Promise<number> {
    const mapping = await this.prisma.parent_student_mapping.findFirst({
      where: { parent_user_id: parentUserId, student_id: studentId },
      select: { students: { select: { user_id: true } } },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: "You may only view your own children's records",
        errorCode: 'NOT_THIS_PARENT',
      });
    }
    return mapping.students.user_id;
  }
}
