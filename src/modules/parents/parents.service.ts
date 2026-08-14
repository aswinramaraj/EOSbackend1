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
    return this.meAcademicCalendarService.getAcademicCalendarForStudentId(studentId);
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
