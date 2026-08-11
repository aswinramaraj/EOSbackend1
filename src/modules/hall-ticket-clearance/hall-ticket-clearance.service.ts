import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateClearanceDto } from './dto/create-clearance.dto';
import { ApproveClearanceDto } from './dto/approve-clearance.dto';
import { RejectClearanceDto } from './dto/reject-clearance.dto';
import { ListClearanceQueryDto } from './dto/list-clearance-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const CLEARANCE_SELECT = {
  id: true,
  clearance_type: true,
  reason: true,
  letter_file_url: true,
  requested_at: true,
  status: true,
  reviewed_at: true,
  valid_until: true,
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
      courses: {
        select: {
          departments: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  exams: {
    select: {
      id: true,
      academic_year: true,
      semester: true,
      exam_types: { select: { id: true, name: true } },
    },
  },
} as const;

interface ClearanceRow {
  id: number;
  clearance_type: string;
  reason: string | null;
  letter_file_url: string | null;
  requested_at: Date;
  status: string;
  reviewed_at: Date | null;
  valid_until: Date | null;
  students: {
    id: number;
    student_id_no: string;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
    courses: { departments: { id: number; name: string; code: string } };
  };
  exams: {
    id: number;
    academic_year: string;
    semester: number;
    exam_types: { id: number; name: string };
  };
}

function resolveStudentName(student: ClearanceRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

/**
 * schema.prisma has no background job / cron in this codebase, so 'expired'
 * is never written to the status column by anything — it's computed here
 * at read-time instead (same technique as class-mentors'
 * isEffectivelyDisclosed), comparing valid_until to today whenever the
 * stored status is still 'approved'.
 */
function computeEffectiveStatus(row: ClearanceRow): string {
  if (row.status === 'approved' && row.valid_until) {
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (row.valid_until < today) {
      return 'expired';
    }
  }
  return row.status;
}

function toResponse(row: ClearanceRow) {
  return {
    id: row.id,
    clearance_type: row.clearance_type,
    reason: row.reason,
    letter_file_url: row.letter_file_url,
    requested_at: row.requested_at,
    status: row.status,
    effective_status: computeEffectiveStatus(row),
    reviewed_at: row.reviewed_at,
    valid_until: row.valid_until,
    student: {
      id: row.students.id,
      student_id_no: row.students.student_id_no,
      name: resolveStudentName(row.students),
      department: row.students.courses.departments,
    },
    exam: {
      id: row.exams.id,
      type: row.exams.exam_types.name,
      academic_year: row.exams.academic_year,
      semester: row.exams.semester,
    },
  };
}

@Injectable()
export class HallTicketClearanceService {
  private readonly logger = new Logger(HallTicketClearanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hall-ticket-clearance (Student only).
   *
   * "Must belong to the exam" is interpreted as: the student's batch must
   * be the batch this exam was created for (exams has no direct student
   * link — batch is the only shared axis in schema.prisma). "Cannot submit
   * after exam starts" is checked against the earliest published
   * exam_timetable.exam_date across this exam's exam_subject_mapping rows
   * (exams itself has no start-date column) — if no timetable has been
   * published yet, nothing blocks the request.
   */
  async create(dto: CreateClearanceDto, userId: number) {
    const student = await this.resolveStudentByUserId(userId);

    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    if (student.batch_id !== exam.batch_id) {
      throw new ForbiddenException({
        message: 'You do not belong to this exam',
        errorCode: 'STUDENT_NOT_IN_EXAM',
      });
    }

    // is_published gates on exam_subject_mapping (same "is this schedule
    // real yet" signal used by MeExamScheduleService/SeatingArrangements) —
    // a still-draft mapping's date shouldn't be able to block a clearance
    // request. exam_timetable is a list relation (one row per timetable
    // version), so every mapping can carry more than one date; flatMap
    // across all of them rather than assuming a single row.
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: dto.exam_id, is_published: true },
      select: { exam_timetable: { select: { exam_date: true } } },
    });
    const scheduledDates = mappings.flatMap((m) =>
      m.exam_timetable.map((t) => t.exam_date),
    );
    if (scheduledDates.length > 0) {
      const earliest = new Date(
        Math.min(...scheduledDates.map((d) => d.getTime())),
      );
      const today = new Date(new Date().toISOString().slice(0, 10));
      if (today >= earliest) {
        throw new UnprocessableEntityException({
          message: 'This exam has already started',
          errorCode: 'EXAM_ALREADY_STARTED',
        });
      }
    }

    const activeRequest =
      await this.prisma.hall_ticket_clearance_exceptions.findFirst({
        where: {
          student_id: student.id,
          exam_id: dto.exam_id,
          status: { in: ['pending', 'approved'] },
        },
      });
    if (activeRequest) {
      throw new ConflictException({
        message: 'You already have an active clearance request for this exam',
        errorCode: 'ACTIVE_REQUEST_EXISTS',
      });
    }

    try {
      const request = await this.prisma.hall_ticket_clearance_exceptions.create(
        {
          data: {
            student_id: student.id,
            exam_id: dto.exam_id,
            clearance_type: dto.clearance_type,
            reason: dto.reason,
          },
          select: CLEARANCE_SELECT,
        },
      );

      this.logger.log(
        `Hall ticket clearance requested: id=${request.id} student=${student.id} exam=${dto.exam_id}`,
      );
      return toResponse(request);
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message:
            'A request of this clearance type already exists for this exam',
          errorCode: 'DUPLICATE_REQUEST',
        });
      }
      throw err;
    }
  }

  /** GET /hall-ticket-clearance/my (Student only — own requests). */
  async findMy(query: ListClearanceQueryDto, userId: number) {
    const student = await this.resolveStudentByUserId(userId);

    const where = { student_id: student.id };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.hall_ticket_clearance_exceptions.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { requested_at: 'desc' },
        select: CLEARANCE_SELECT,
      }),
      this.prisma.hall_ticket_clearance_exceptions.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /hall-ticket-clearance/pending (HoD only). */
  async findPending(query: ListClearanceQueryDto) {
    const where = { status: 'pending' as const };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.hall_ticket_clearance_exceptions.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { requested_at: 'asc' },
        select: CLEARANCE_SELECT,
      }),
      this.prisma.hall_ticket_clearance_exceptions.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /**
   * GET /hall-ticket-clearance/:id (Student: own only / HoD: any).
   * For HoD, also surfaces the student's other past requests ("Previous
   * requests" from the workflow) — fee-due information is NOT included
   * here: it would come from the Billing module, which is out of this
   * module's scope and still an unimplemented stub in this codebase.
   */
  async findOne(id: number, currentUser: JwtPayload) {
    const request =
      await this.prisma.hall_ticket_clearance_exceptions.findUnique({
        where: { id },
        select: { ...CLEARANCE_SELECT, student_id: true },
      });
    if (!request) {
      throw new NotFoundException('Clearance request not found');
    }

    let previousRequests: ReturnType<typeof toResponse>[] = [];

    if (currentUser.role === ROLES.STUDENT) {
      const student = await this.resolveStudentByUserId(currentUser.sub);
      if (request.student_id !== student.id) {
        throw new ForbiddenException(
          'You may only view your own clearance requests',
        );
      }
    } else {
      const others =
        await this.prisma.hall_ticket_clearance_exceptions.findMany({
          where: { student_id: request.student_id, id: { not: id } },
          orderBy: { requested_at: 'desc' },
          select: CLEARANCE_SELECT,
        });
      previousRequests = others.map(toResponse);
    }

    return { ...toResponse(request), previous_requests: previousRequests };
  }

  /** PATCH /hall-ticket-clearance/:id/approve (HoD only — pending requests only). */
  async approve(id: number, dto: ApproveClearanceDto, hodUserId: number) {
    const existing =
      await this.prisma.hall_ticket_clearance_exceptions.findUnique({
        where: { id },
      });
    if (!existing) {
      throw new NotFoundException('Clearance request not found');
    }
    if (existing.status !== 'pending') {
      throw new ConflictException({
        message: 'Only a pending request can be approved',
        errorCode: 'NOT_PENDING',
      });
    }

    const request = await this.prisma.hall_ticket_clearance_exceptions.update({
      where: { id },
      data: {
        status: 'approved',
        valid_until: new Date(dto.valid_until),
        letter_file_url: dto.letter_file_url,
        reviewed_by_hod_user_id: hodUserId,
        reviewed_at: new Date(),
      },
      select: CLEARANCE_SELECT,
    });

    this.logger.log(
      `Hall ticket clearance approved: id=${id} by user=${hodUserId}`,
    );
    return toResponse(request);
  }

  /** PATCH /hall-ticket-clearance/:id/reject (HoD only — pending requests only). */
  async reject(id: number, _dto: RejectClearanceDto, hodUserId: number) {
    const existing =
      await this.prisma.hall_ticket_clearance_exceptions.findUnique({
        where: { id },
      });
    if (!existing) {
      throw new NotFoundException('Clearance request not found');
    }
    if (existing.status !== 'pending') {
      throw new ConflictException({
        message: 'Only a pending request can be rejected',
        errorCode: 'NOT_PENDING',
      });
    }

    const request = await this.prisma.hall_ticket_clearance_exceptions.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewed_by_hod_user_id: hodUserId,
        reviewed_at: new Date(),
      },
      select: CLEARANCE_SELECT,
    });

    this.logger.log(
      `Hall ticket clearance rejected: id=${id} by user=${hodUserId}`,
    );
    return toResponse(request);
  }

  private async resolveStudentByUserId(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException(
        'Student profile not found for the authenticated user',
      );
    }
    return student;
  }
}
