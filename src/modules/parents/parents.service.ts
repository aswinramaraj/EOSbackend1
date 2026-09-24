import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeAttendanceService } from 'src/modules/admissions/students/me-profile/me-attendance.service';
import { MeExamResultsService } from 'src/modules/admissions/students/me-profile/me-exam-results.service';
import { MeFeesService } from 'src/modules/admissions/students/me-profile/me-fees.service';
import { MeAcademicCalendarService } from 'src/modules/admissions/students/me-profile/me-academic-calendar.service';
import { MeHostelRoomService } from 'src/modules/admissions/students/me-profile/me-hostel-room.service';
import { MeHostelNightAttendanceService } from 'src/modules/admissions/students/me-profile/me-hostel-night-attendance.service';
import { GetHostelNightAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-hostel-night-attendance.dto';
import { GetAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-attendance.dto';
import { GetExamResultsDto } from 'src/modules/admissions/students/me-profile/dto/get-exam-results.dto';
import { TimetableService } from 'src/modules/faculty/timetable/timetable.service';
import { GetMyTimetableQueryDto } from 'src/modules/faculty/timetable/dto/get-my-timetable-query.dto';
import { DrivesService } from 'src/modules/placement/drives/drives.service';
import { FeePaymentService } from 'src/modules/fees-billing/fee-payments/fee-payment.service';
import { CreateFeePaymentOrderDto } from 'src/modules/fees-billing/fee-payments/dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from 'src/modules/fees-billing/fee-payments/dto/verify-fee-payment.dto';
import { ProfileService } from 'src/modules/profile/profile.service';
import { CanteenOrderingService } from 'src/modules/canteen-ordering/canteen-ordering.service';
import { StationeryService } from 'src/modules/stationery/stationery.service';
import { StationaryService } from 'src/modules/stationary/stationary.service';
import { BorrowRecordsService } from 'src/modules/library/borrow-records/borrow-records.service';
import { GetMyBorrowRecordsDto } from 'src/modules/library/borrow-records/dto/get-my-borrow-records.dto';
import { SearchBorrowRecordsDto } from 'src/modules/library/borrow-records/dto/search-borrow-records.dto';
import { MedicalAppointmentsService } from 'src/modules/medical-centre/medical-appointments.service';
import { MeExamScheduleService } from 'src/modules/admissions/students/me-profile/me-exam-schedule.service';
import { MeCareerPathService } from 'src/modules/admissions/students/me-profile/me-career-path.service';
import { MeLeavesListService } from 'src/modules/admissions/students/me-profile/me-leaves-list.service';
import { GetLeavesDto } from 'src/modules/admissions/students/me-profile/dto/get-leaves.dto';
import { MeOdRequestsListService } from 'src/modules/admissions/students/me-profile/me-od-requests-list.service';
import { GetOdRequestsDto } from 'src/modules/admissions/students/me-profile/dto/get-od-requests.dto';
import { MeBonafideRequestsService } from 'src/modules/admissions/students/me-profile/me-bonafide-requests.service';
import { GetBonafideRequestsDto } from 'src/modules/admissions/students/me-profile/dto/get-bonafide-requests.dto';
import { MeHostelOutingsService } from 'src/modules/admissions/students/me-profile/me-hostel-outings.service';
import { GetHostelOutingsDto } from 'src/modules/admissions/students/me-profile/dto/get-hostel-outings.dto';
import { MeCampusOutingsService } from 'src/modules/admissions/students/me-profile/me-campus-outings.service';
import { GetCampusOutingsDto } from 'src/modules/admissions/students/me-profile/dto/get-campus-outings.dto';
import { HallTicketClearanceService } from 'src/modules/hall-ticket-clearance/hall-ticket-clearance.service';
import { ListClearanceQueryDto } from 'src/modules/hall-ticket-clearance/dto/list-clearance-query.dto';
import { LmsService } from 'src/modules/lms/lms.service';
import { StudentHigherEducationService } from 'src/modules/student-higher-education/student-higher-education.service';
import { StudentEntrepreneurshipService } from 'src/modules/student-entrepreneurship/student-entrepreneurship.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

interface ChildRow {
  students: {
    id: number;
    student_id_no: string;
    roll_no: string | null;
    student_type: string;
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
    student_type: student.student_type,
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
    private readonly meHostelRoomService: MeHostelRoomService,
    private readonly meHostelNightAttendanceService: MeHostelNightAttendanceService,
    private readonly timetableService: TimetableService,
    private readonly drivesService: DrivesService,
    private readonly feePaymentService: FeePaymentService,
    private readonly profileService: ProfileService,
    private readonly canteenOrderingService: CanteenOrderingService,
    private readonly stationeryService: StationeryService,
    private readonly stationaryService: StationaryService,
    private readonly borrowRecordsService: BorrowRecordsService,
    private readonly medicalAppointmentsService: MedicalAppointmentsService,
    private readonly meExamScheduleService: MeExamScheduleService,
    private readonly meCareerPathService: MeCareerPathService,
    private readonly meLeavesListService: MeLeavesListService,
    private readonly meOdRequestsListService: MeOdRequestsListService,
    private readonly meBonafideRequestsService: MeBonafideRequestsService,
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
            student_type: true,
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

  /**
   * GET /me/children/:studentId/marksheet/:semester (Parent only). Same
   * rendered PDF as the student's own marksheet download — see
   * MeExamResultsService.getMarksheetDataForStudentId.
   */
  async getChildMarksheet(
    parentUserId: number,
    studentId: number,
    semester: number,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meExamResultsService.getMarksheetDataForStudentId(
      studentId,
      semester,
    );
  }

  /** GET /me/children/:studentId/fees (Parent only). */
  async getChildFees(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meFeesService.getFeesForStudentId(studentId);
  }

  /**
   * GET /me/children/:studentId/fees/payments/:paymentId/receipt (Parent
   * only). Same rendered PDF as the student's own receipt download - see
   * MeFeesService.getReceiptDataForStudentId, which independently re-checks
   * that the payment actually belongs to this exact studentId (not just
   * that the parent owns the child), so this can never leak a sibling's or
   * another family's receipt even with a guessed payment id.
   */
  async getChildFeeReceipt(
    parentUserId: number,
    studentId: number,
    paymentId: number,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meFeesService.getReceiptDataForStudentId(studentId, paymentId);
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

  /**
   * GET /me/children/:studentId/profile (Parent only) - the child's full
   * profile, same Personal/Contact/Family/resume shape the student sees on
   * their own Profile & Resume page (see ProfileService.getStudentProfile).
   */
  async getChildProfile(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.profileService.getStudentProfileByStudentId(studentId);
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

  /**
   * GET /me/children/:studentId/hostel-room (Parent only, own child). Backs
   * the Hostel tab this parent gets instead of "My Bus" once their child's
   * student_type is 'hosteller' (see app/(tabs)/_layout.tsx's isHosteller
   * branch) - same is_hostel_resident:false-is-not-an-error convention as
   * MeHostelRoomService.
   */
  async getChildHostelRoom(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meHostelRoomService.getHostelRoomForStudentId(studentId);
  }

  /** GET /me/children/:studentId/hostel-night-attendance (Parent only, own child). */
  async getChildNightAttendance(
    parentUserId: number,
    studentId: number,
    query: GetHostelNightAttendanceDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.meHostelNightAttendanceService.getNightAttendanceForStudentId(
      studentId,
      parentUserId,
      query,
    );
  }

  /**
   * GET /me/children/:studentId/hostel-gate-log (Parent only, own child).
   * Read-only view of the same hostel_in_out_ledger the gate_warden's own
   * GateLogService writes (src/modules/hostel/gate-log) - most-recent-first,
   * capped at 60 rows (a bit over a month at 2 rows/day) since there's no
   * warden console pagination need to match here.
   */
  async getChildGateLog(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const rows = await this.prisma.hostel_in_out_ledger.findMany({
      where: { student_id: studentId },
      orderBy: { recorded_at: 'desc' },
      take: 60,
      select: { id: true, entry_type: true, recorded_at: true },
    });
    return rows.map((r) => ({
      id: r.id,
      entry_type: r.entry_type,
      recorded_at: r.recorded_at,
    }));
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
   * See getChildCraveoOrders below for the full-history variant.
   */
  async getChildCanteenOrders(parentUserId: number, studentId: number) {
    const childUserId = await this.assertOwnChildUserId(
      parentUserId,
      studentId,
    );
    return this.canteenOrderingService.listMyOrders(childUserId);
  }

  /** GET /me/children/:studentId/library-records (Parent only). See getChildLibraryHistory below for the full-history variant. */
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
   * read-only child route this service exposes. Filtered by the
   * `student_id` column directly (see
   * MedicalAppointmentsService.listForStudentId's own doc comment) rather
   * than by booker user id, so it also catches appointments staff booked on
   * the child's behalf.
   */
  async getChildMedicalAppointments(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.medicalAppointmentsService.listForStudentId(studentId);
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

  /**
   * GET /me/children/:studentId/leaves (Parent only, own child). Read-only:
   * no create. Reuses MeLeavesListService's own paginated/filtered shape
   * (status/routed_to_warden/page/page_size query params, resolved approver
   * names - see that service's own doc comment for the base fields) and
   * layers on `kind` (derived from routed_to_warden) plus this parent's own
   * `acknowledged_at` per row - both the Progress tab's Leave requests AND
   * the Hostel tab's Leave requests come back here, and this is the single
   * feed the Parent's "Acknowledge" page's Leave section reads.
   */
  async getChildLeaves(
    parentUserId: number,
    studentId: number,
    dto: GetLeavesDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    const result = await this.meLeavesListService.getLeavesForStudentId(
      studentId,
      dto,
    );
    const acknowledgements =
      await this.prisma.leave_parent_acknowledgements.findMany({
        where: {
          parent_user_id: parentUserId,
          leave_id: { in: result.data.map((row) => row.id) },
        },
        select: { leave_id: true, acknowledged_at: true },
      });
    const acknowledgedAtByLeaveId = new Map(
      acknowledgements.map((a) => [a.leave_id, a.acknowledged_at]),
    );
    return {
      ...result,
      data: result.data.map((row) => ({
        ...row,
        kind: row.routed_to_warden ? 'hostel_leave' : 'leave',
        acknowledged_at: acknowledgedAtByLeaveId.get(row.id) ?? null,
      })),
    };
  }

  /**
   * POST /me/children/:studentId/leaves/:leaveId/acknowledge (Parent only,
   * own child). Idempotent - re-acknowledging just bumps acknowledged_at.
   * Covers both Leave and Hostel Leave (same table, see getChildLeaves).
   */
  async acknowledgeChildLeave(
    parentUserId: number,
    studentId: number,
    leaveId: number,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    const leave = await this.prisma.student_leaves.findFirst({
      where: { id: leaveId, student_id: studentId },
      select: { id: true },
    });
    if (!leave) {
      throw new NotFoundException({
        message: 'Leave request not found',
        errorCode: 'LEAVE_REQUEST_NOT_FOUND',
      });
    }
    const ack = await this.prisma.leave_parent_acknowledgements.upsert({
      where: {
        leave_id_parent_user_id: {
          leave_id: leaveId,
          parent_user_id: parentUserId,
        },
      },
      create: {
        leave_id: leaveId,
        parent_user_id: parentUserId,
        acknowledged_at: new Date(),
      },
      update: { acknowledged_at: new Date() },
    });
    return { leave_id: leaveId, acknowledged_at: ack.acknowledged_at };
  }

  /**
   * GET /me/children/:studentId/od-requests (Parent only, own child).
   * Read-only status list — no team creation/join/leave, no full team
   * roster (see MeOdRequestsListService.getOdRequestsForStudentId's own doc
   * comment). Layers on this parent's own `acknowledged_at` per row - the
   * Parent's "Acknowledge" page's OD section.
   */
  async getChildOdRequests(
    parentUserId: number,
    studentId: number,
    dto: GetOdRequestsDto,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    const result = await this.meOdRequestsListService.getOdRequestsForStudentId(
      studentId,
      dto,
    );
    const acknowledgements =
      await this.prisma.od_request_parent_acknowledgements.findMany({
        where: {
          parent_user_id: parentUserId,
          od_request_id: { in: result.data.map((row) => row.id) },
        },
        select: { od_request_id: true, acknowledged_at: true },
      });
    const acknowledgedAtByRequestId = new Map(
      acknowledgements.map((a) => [a.od_request_id, a.acknowledged_at]),
    );
    return {
      ...result,
      data: result.data.map((row) => ({
        ...row,
        acknowledged_at: acknowledgedAtByRequestId.get(row.id) ?? null,
      })),
    };
  }

  /**
   * POST /me/children/:studentId/od-requests/:odRequestId/acknowledge
   * (Parent only, own child). Idempotent, same shape as acknowledgeChildLeave.
   */
  async acknowledgeChildOdRequest(
    parentUserId: number,
    studentId: number,
    odRequestId: number,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    const request = await this.prisma.od_requests.findFirst({
      where: {
        id: odRequestId,
        od_teams: {
          OR: [
            { created_by_student_id: studentId },
            { od_team_members: { some: { student_id: studentId } } },
          ],
        },
      },
      select: { id: true },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }
    const ack = await this.prisma.od_request_parent_acknowledgements.upsert({
      where: {
        od_request_id_parent_user_id: {
          od_request_id: odRequestId,
          parent_user_id: parentUserId,
        },
      },
      create: {
        od_request_id: odRequestId,
        parent_user_id: parentUserId,
        acknowledged_at: new Date(),
      },
      update: { acknowledged_at: new Date() },
    });
    return { od_request_id: odRequestId, acknowledged_at: ack.acknowledged_at };
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

  /**
   * GET /me/children/:studentId/craveo-orders (Parent only, own child).
   * Read-only order history - a parent never orders on the child's
   * behalf, so there's no cart/checkout surface here, only the history a
   * student's own "Orders" screen already shows them.
   */
  async getChildCraveoOrders(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const studentUserId = await this.resolveStudentUserId(studentId);
    return this.canteenOrderingService.listOrdersForStudentUserId(
      studentUserId,
    );
  }

  /** GET /me/children/:studentId/library-history (Parent only, own child). */
  async getChildLibraryHistory(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    // Reuses BorrowRecordsService.findAll's own `student_id` filter -
    // already unrestricted for any role other than student/faculty/hod
    // (see that method's own comment), so a synthetic 'parent'-role
    // JwtPayload here just carries the student_id filter through rather
    // than being narrowed to "the caller's own" rows, which is correct -
    // ownership was already checked above via assertOwnChild.
    const query = new SearchBorrowRecordsDto();
    query.student_id = studentId;
    query.page = 1;
    query.page_size = 100;
    const callerAsJwt: JwtPayload = {
      sub: parentUserId,
      role: 'parent',
      email: '',
      roleId: 0,
    };
    return this.borrowRecordsService.findAll(query, callerAsJwt);
  }

  /** GET /me/children/:studentId/stationery-orders (Parent only, own child). */
  async getChildStationeryOrders(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const studentUserId = await this.resolveStudentUserId(studentId);
    return this.stationeryService.listMyOrders(studentUserId);
  }

  /** GET /me/children/:studentId/stationary-requests (Parent only, own child) - Copy Center. */
  async getChildStationaryRequests(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const studentUserId = await this.resolveStudentUserId(studentId);
    return this.stationaryService.listMyRequests(studentUserId);
  }

  /**
   * POST /me/children/:studentId/feedback (Parent only, own child) -
   * free-text feedback about this specific child, not a form-based
   * service review (see parent_feedback's own schema comment for why this
   * doesn't reuse feedback_forms/feedback_responses).
   */
  async submitChildFeedback(
    parentUserId: number,
    studentId: number,
    message: string,
    rating?: number,
  ) {
    await this.assertOwnChild(parentUserId, studentId);
    const row = await this.prisma.parent_feedback.create({
      data: {
        parent_user_id: parentUserId,
        student_id: studentId,
        category: 'about_student',
        message,
        rating,
      },
    });
    return { id: row.id, created_at: row.created_at };
  }

  /** POST /me/feedback/college (Parent only) - free-text feedback about the college in general, not tied to any one child. */
  async submitCollegeFeedback(
    parentUserId: number,
    message: string,
    rating?: number,
  ) {
    const row = await this.prisma.parent_feedback.create({
      data: {
        parent_user_id: parentUserId,
        student_id: null,
        category: 'about_college',
        message,
        rating,
      },
    });
    return { id: row.id, created_at: row.created_at };
  }

  /**
   * Resolves a child's own `users.id` for the 3 services (Craveo,
   * Stationery, Stationary) whose tables are keyed by user_id rather than
   * student_id directly - students.user_id is a required, unique column,
   * so this can never come back empty for a real student row.
   */
  private async resolveStudentUserId(studentId: number): Promise<number> {
    const student = await this.prisma.students.findUniqueOrThrow({
      where: { id: studentId },
      select: { user_id: true },
    });
    return student.user_id;
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
