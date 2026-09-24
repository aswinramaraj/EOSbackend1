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
import { MedicalAppointmentsService } from 'src/modules/medical-centre/medical-appointments.service';
import { BorrowRecordsService } from 'src/modules/library/borrow-records/borrow-records.service';
import { SearchBorrowRecordsDto } from 'src/modules/library/borrow-records/dto/search-borrow-records.dto';
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
    private readonly medicalAppointmentsService: MedicalAppointmentsService,
    private readonly borrowRecordsService: BorrowRecordsService,
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
    return this.meAcademicCalendarService.getAcademicCalendarForStudentId(studentId);
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
    return this.meHostelNightAttendanceService.getNightAttendanceForStudentId(studentId, parentUserId, query);
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
   * GET /me/children/:studentId/leaves (Parent only, own child). Both the
   * Progress tab's Leave requests AND the Hostel tab's Leave requests come
   * back here - they're the same underlying student_leaves table (see
   * StudentLeavesService/LeaveRequestsService's own doc comments),
   * distinguished only by `kind`, derived from routed_to_warden. This is
   * the single feed the Parent's "Acknowledge" page's Leave section reads.
   */
  async getChildLeaves(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const rows = await this.prisma.student_leaves.findMany({
      where: { student_id: studentId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        from_date: true,
        to_date: true,
        reason: true,
        status: true,
        routed_to_warden: true,
        created_at: true,
        leave_parent_acknowledgements: {
          where: { parent_user_id: parentUserId },
          select: { acknowledged_at: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.routed_to_warden ? 'hostel_leave' : 'leave',
      from_date: r.from_date,
      to_date: r.to_date,
      reason: r.reason,
      status: r.status,
      created_at: r.created_at,
      acknowledged_at: r.leave_parent_acknowledgements[0]?.acknowledged_at ?? null,
    }));
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
        leave_id_parent_user_id: { leave_id: leaveId, parent_user_id: parentUserId },
      },
      create: { leave_id: leaveId, parent_user_id: parentUserId, acknowledged_at: new Date() },
      update: { acknowledged_at: new Date() },
    });
    return { leave_id: leaveId, acknowledged_at: ack.acknowledged_at };
  }

  /**
   * GET /me/children/:studentId/od-requests (Parent only, own child).
   * Includes every OD request where this child is either the team creator
   * or a joined member - the Parent's Acknowledge page's OD section.
   */
  async getChildOdRequests(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const rows = await this.prisma.od_requests.findMany({
      where: {
        od_teams: {
          OR: [
            { created_by_student_id: studentId },
            { od_team_members: { some: { student_id: studentId } } },
          ],
        },
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        from_date: true,
        to_date: true,
        reason: true,
        mentor_approval_status: true,
        created_at: true,
        od_teams: { select: { unique_code: true, team_name: true } },
        od_request_parent_acknowledgements: {
          where: { parent_user_id: parentUserId },
          select: { acknowledged_at: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      unique_code: r.od_teams.unique_code,
      team_name: r.od_teams.team_name,
      from_date: r.from_date,
      to_date: r.to_date,
      reason: r.reason,
      status: r.mentor_approval_status,
      created_at: r.created_at,
      acknowledged_at:
        r.od_request_parent_acknowledgements[0]?.acknowledged_at ?? null,
    }));
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

  /**
   * GET /me/children/:studentId/craveo-orders (Parent only, own child).
   * Read-only order history - a parent never orders on the child's
   * behalf, so there's no cart/checkout surface here, only the history a
   * student's own "Orders" screen already shows them.
   */
  async getChildCraveoOrders(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    const studentUserId = await this.resolveStudentUserId(studentId);
    return this.canteenOrderingService.listOrdersForStudentUserId(studentUserId);
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
    const callerAsJwt: JwtPayload = { sub: parentUserId, role: 'parent', email: '', roleId: 0 };
    return this.borrowRecordsService.findAll(query, callerAsJwt);
  }

  /** GET /me/children/:studentId/medical-appointments (Parent only, own child). */
  async getChildMedicalAppointments(parentUserId: number, studentId: number) {
    await this.assertOwnChild(parentUserId, studentId);
    return this.medicalAppointmentsService.listForStudentId(studentId);
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
      data: { parent_user_id: parentUserId, student_id: studentId, category: 'about_student', message, rating },
    });
    return { id: row.id, created_at: row.created_at };
  }

  /** POST /me/feedback/college (Parent only) - free-text feedback about the college in general, not tied to any one child. */
  async submitCollegeFeedback(parentUserId: number, message: string, rating?: number) {
    const row = await this.prisma.parent_feedback.create({
      data: { parent_user_id: parentUserId, student_id: null, category: 'about_college', message, rating },
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
        message: 'You may only view your own children\'s records',
        errorCode: 'NOT_THIS_PARENT',
      });
    }
  }
}
