import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { SearchLeaveRequestsDto } from './dto/search-leave-requests.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const LEAVE_REQUEST_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      roll_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      student_hostel_mapping: {
        select: {
          hostel_rooms: {
            select: {
              room_number: true,
              hostels: { select: { id: true, name: true, code: true } },
            },
          },
        },
      },
    },
  },
  users_student_leaves_approved_by_warden_user_idTousers: {
    select: { email: true },
  },
} satisfies Prisma.student_leavesInclude;

type LeaveRequestWithRelations = Prisma.student_leavesGetPayload<{
  include: typeof LEAVE_REQUEST_INCLUDE;
}>;

function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  student_id_no: string;
}): string {
  return student.soa_applications
    ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
    : `Student ${student.student_id_no}`;
}

function toLeaveRequestResponse(request: LeaveRequestWithRelations) {
  const student = request.students;
  const room = student.student_hostel_mapping?.hostel_rooms;

  return {
    id: request.id,
    student: {
      id: student.id,
      name: resolveStudentName(student),
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
    },
    hostel: room?.hostels ?? null,
    room_number: room?.room_number ?? null,
    from_date: toDateOnly(request.from_date),
    to_date: toDateOnly(request.to_date),
    reason: request.reason,
    status: request.status,
    approved_by_warden:
      request.users_student_leaves_approved_by_warden_user_idTousers?.email ??
      null,
    created_at: request.created_at.toISOString(),
  };
}

/**
 * Warden-side review of Hostel-tab leave requests. These live in the same
 * `student_leaves` table as academic leaves (see prisma/README.md) —
 * distinguished from them by `routed_to_warden: true`, which every query
 * here ANDs into its where clause so an academic-chain leave can never
 * surface (or be decided) through this module.
 */
@Injectable()
export class LeaveRequestsService {
  private readonly logger = new Logger(LeaveRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /hostel/leave-requests?status=&page=&page_size= — warden-side review queue, mirrors OutingsService.findAll. */
  async findAll(dto: SearchLeaveRequestsDto) {
    const { status, page = 1, page_size = 20 } = dto;
    const where: Prisma.student_leavesWhereInput = { routed_to_warden: true };
    if (status) where.status = status;

    try {
      const [requests, total] = await this.prisma.$transaction([
        this.prisma.student_leaves.findMany({
          where,
          include: LEAVE_REQUEST_INCLUDE,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.student_leaves.count({ where }),
      ]);

      return {
        page,
        page_size,
        total,
        data: requests.map(toLeaveRequestResponse),
      };
    } catch (err) {
      this.logger.error('DB error while fetching hostel leave requests', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel/leave-requests/:id/decision
   *
   * Error cases:
   *  404 LEAVE_REQUEST_NOT_FOUND       – no routed_to_warden=true request
   *                                      with this id (an academic-chain
   *                                      leave id is treated the same as a
   *                                      nonexistent one here — it simply
   *                                      isn't this queue's to decide)
   *  409 LEAVE_REQUEST_ALREADY_DECIDED – request is not currently pending
   */
  async decide(id: number, dto: DecideLeaveRequestDto, wardenUserId: number) {
    let request: { status: string; routed_to_warden: boolean } | null;
    try {
      request = await this.prisma.student_leaves.findUnique({
        where: { id },
        select: { status: true, routed_to_warden: true },
      });
    } catch (err) {
      this.logger.error('DB error during hostel leave request lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!request || !request.routed_to_warden) {
      throw new NotFoundException({
        message: 'Hostel leave request not found',
        errorCode: 'LEAVE_REQUEST_NOT_FOUND',
      });
    }
    if (request.status !== 'pending') {
      throw new ConflictException({
        message: 'This hostel leave request has already been decided',
        errorCode: 'LEAVE_REQUEST_ALREADY_DECIDED',
      });
    }

    try {
      const updated = await this.prisma.student_leaves.update({
        where: { id },
        data: {
          status: dto.decision === 'approved' ? 'warden_approved' : 'rejected',
          approved_by_warden_user_id: wardenUserId,
        },
        include: LEAVE_REQUEST_INCLUDE,
      });
      return toLeaveRequestResponse(updated);
    } catch (err) {
      this.logger.error('DB error while deciding hostel leave request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/leave-requests/from-academic-leave — read-only visibility
   * into academic Leave-tab requests (student_leaves, routed_to_warden:
   * false) the student flagged "also on hostel leave". These never reach
   * this module's own pending/decide flow — they're approved through the
   * unchanged Student -> Faculty -> HoD chain (student-leaves.service.ts);
   * the Warden can see their status here but cannot act on them.
   */
  async findFromAcademicLeave(dto: SearchLeaveRequestsDto) {
    const { page = 1, page_size = 20 } = dto;
    const where: Prisma.student_leavesWhereInput = {
      also_on_hostel_leave: true,
      routed_to_warden: false,
    };

    try {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.student_leaves.findMany({
          where,
          select: {
            id: true,
            from_date: true,
            to_date: true,
            reason: true,
            status: true,
            created_at: true,
            students: {
              select: {
                id: true,
                student_id_no: true,
                roll_no: true,
                soa_applications: {
                  select: { first_name: true, last_name: true },
                },
              },
            },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.student_leaves.count({ where }),
      ]);

      return {
        page,
        page_size,
        total,
        data: rows.map((row) => ({
          id: row.id,
          student: {
            id: row.students.id,
            name: resolveStudentName(row.students),
            student_id_no: row.students.student_id_no,
            roll_no: row.students.roll_no,
          },
          from_date: toDateOnly(row.from_date),
          to_date: toDateOnly(row.to_date),
          reason: row.reason,
          // Academic status (pending/faculty_approved/hod_approved/rejected)
          // — informational only, the Warden cannot decide these here.
          status: row.status,
          created_at: row.created_at.toISOString(),
        })),
      };
    } catch (err) {
      this.logger.error(
        'DB error while fetching hostel-flagged academic leaves',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
