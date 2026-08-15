import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeaveDto } from './dto/create-leave.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class MeLeavesService {
  private readonly logger = new Logger(MeLeavesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/leaves
   *
   * Self-scoped: student_id resolved from the JWT, never accepted from the
   * request. Always starts at status='pending' with every approval column
   * null — this endpoint does not check whether a mentor is assigned yet (a
   * soft dependency per the spec's own note), and does not check for
   * overlapping requests (no constraint in the schema, explicitly deferred
   * by the spec).
   *
   * `routed_to_warden` (set only by the Hostel tab's own Leave form) skips
   * Faculty/HoD entirely — the Warden decides it alone, via the
   * hostel/leave-requests module. Everything else about creation is
   * identical between the two tabs; only the downstream approval path
   * differs, which is why this stays one endpoint/table instead of a
   * separate one — see prisma/README.md for the schema rationale.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND   – authenticated user has no linked student
   *                            record (same defensive consistency check as
   *                            the sibling /me/* endpoints; spec marks this
   *                            "not applicable" but it never fires for a
   *                            real, correctly-provisioned student account)
   *  422 INVALID_DATE_RANGE  – from_date in the past, or from_date > to_date
   *  422 NOT_A_HOSTELLER     – routed_to_warden=true but the caller has no
   *                            student_hostel_mapping row (same hosteller
   *                            gate every other hostel-tab write in this
   *                            module already uses)
   *  500 INTERNAL_ERROR      – unexpected DB failure
   */
  async createLeave(userId: number, dto: CreateLeaveDto) {
    const fromDate = new Date(dto.from_date);
    const toDate = new Date(dto.to_date);

    if (fromDate < startOfToday() || fromDate > toDate) {
      throw new UnprocessableEntityException({
        message:
          'from_date must not be in the past and must be on or before to_date',
        errorCode: 'INVALID_DATE_RANGE',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (dto.routed_to_warden) {
      const hostelMapping = await this.prisma.student_hostel_mapping.findUnique(
        {
          where: { student_id: student.id },
        },
      );
      if (!hostelMapping) {
        throw new UnprocessableEntityException({
          message: 'Only hostellers can request hostel leave',
          errorCode: 'NOT_A_HOSTELLER',
        });
      }
    }

    const leave = await this.insertLeave(
      userId,
      student.id,
      dto,
      fromDate,
      toDate,
    );

    return {
      id: leave.id,
      student_id: leave.student_id,
      from_date: toDateOnly(leave.from_date),
      to_date: toDateOnly(leave.to_date),
      reason: leave.reason,
      status: leave.status,
      approved_by_faculty_id: leave.approved_by_faculty_id,
      approved_by_hod_user_id: leave.approved_by_hod_user_id,
      approved_by_warden_user_id: leave.approved_by_warden_user_id,
      also_on_hostel_leave: leave.also_on_hostel_leave,
      routed_to_warden: leave.routed_to_warden,
    };
  }

  private async insertLeave(
    userId: number,
    studentId: number,
    dto: CreateLeaveDto,
    fromDate: Date,
    toDate: Date,
  ) {
    try {
      return await this.prisma.student_leaves.create({
        data: {
          student_id: studentId,
          from_date: fromDate,
          to_date: toDate,
          reason: dto.reason,
          status: 'pending',
          also_on_hostel_leave: dto.also_on_hostel_leave ?? false,
          routed_to_warden: dto.routed_to_warden ?? false,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create leave request for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
