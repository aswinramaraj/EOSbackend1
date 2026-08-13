import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ListOdHodApprovalQueryDto } from './dto/list-od-hod-approval-query.dto';
import { ReviewOdHodApprovalDto } from './dto/review-od-hod-approval.dto';

/**
 * Prisma's default $transaction maxWait (2000ms) is too tight for this
 * project's Supabase pooler round-trip under real-world latency — the batch
 * $transaction below was observed failing at a hard ~2.0-2.3s ceiling
 * ("Unable to start a transaction in the given time"), not intermittently,
 * so this raises the budget rather than papering over a one-off blip.
 */
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 15000 };

const HOD_APPROVAL_SELECT = {
  id: true,
  od_request_id: true,
  student_id: true,
  department_id: true,
  status: true,
  reviewed_at: true,
  departments: { select: { name: true } },
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { id: true, email: true } },
      classes: { select: { section: true, current_semester: true } },
    },
  },
  od_requests: {
    select: {
      id: true,
      from_date: true,
      to_date: true,
      reason: true,
      organization: true,
      location: true,
      created_at: true,
      od_teams: { select: { unique_code: true } },
    },
  },
} as const;

interface HodApprovalRow {
  id: number;
  od_request_id: number;
  student_id: number;
  department_id: number;
  status: string;
  reviewed_at: Date | null;
  departments: { name: string };
  students: {
    id: number;
    student_id_no: string;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { id: number; email: string };
    classes: { section: string; current_semester: number | null } | null;
  };
  od_requests: {
    id: number;
    from_date: Date;
    to_date: Date;
    reason: string | null;
    organization: string | null;
    location: string | null;
    created_at: Date;
    od_teams: { unique_code: string };
  };
}

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

/** Same fallback chain used everywhere else - no generic display-name column on `students`. */
function resolveStudentName(student: HodApprovalRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toResponse(row: HodApprovalRow) {
  return {
    id: row.id,
    status: row.status,
    reviewed_at: row.reviewed_at,
    department_name: row.departments.name,
    student: {
      id: row.students.id,
      student_id_no: row.students.student_id_no,
      name: resolveStudentName(row.students),
      section: row.students.classes?.section ?? null,
      year_label:
        row.students.classes?.current_semester != null
          ? yearLabelForSemester(row.students.classes.current_semester)
          : null,
    },
    od_request: {
      id: row.od_requests.id,
      unique_code: row.od_requests.od_teams.unique_code,
      from_date: row.od_requests.from_date,
      to_date: row.od_requests.to_date,
      reason: row.od_requests.reason,
      organization: row.od_requests.organization,
      location: row.od_requests.location,
      created_at: row.od_requests.created_at,
    },
  };
}

/**
 * The second (per-member) stage of the student OD approval chain -
 * od_request_hod_approvals rows have existed since the team/request feature
 * shipped, but nothing ever read or wrote them until now (mentor approval in
 * student-ods.service.ts only advances od_requests.mentor_approval_status,
 * a separate column). Scoped by the HoD's own department - the schema's
 * department_id column on this table exists specifically to route each
 * member's approval to their own department's HoD.
 */
@Injectable()
export class OdHodApprovalsService {
  private readonly logger = new Logger(OdHodApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** GET /me/od-hod-approvals (HoD only) - the caller's own department's queue. */
  async findAll(query: ListOdHodApprovalQueryDto, userId: number) {
    const hod = await this.resolveHodByUserId(userId);

    const where = {
      department_id: hod.department_id,
      status: query.status,
    };

    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.od_request_hod_approvals.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { id: 'desc' },
          select: HOD_APPROVAL_SELECT,
        }),
        this.prisma.od_request_hod_approvals.count({ where }),
      ],
      TRANSACTION_OPTIONS,
    );

    return paginate(rows.map(toResponse), total, query);
  }

  /** PATCH /me/od-hod-approvals/:id (HoD only - only for their own department). */
  async review(id: number, dto: ReviewOdHodApprovalDto, userId: number) {
    const hod = await this.resolveHodByUserId(userId);

    const approval = await this.prisma.od_request_hod_approvals.findUnique({
      where: { id },
      select: HOD_APPROVAL_SELECT,
    });
    if (!approval) {
      throw new NotFoundException({
        message: 'OD approval not found',
        errorCode: 'OD_APPROVAL_NOT_FOUND',
      });
    }

    if (approval.department_id !== hod.department_id) {
      throw new ForbiddenException({
        message: 'You may only review requests routed to your own department',
        errorCode: 'NOT_YOUR_DEPARTMENT',
      });
    }

    if (approval.status !== 'pending') {
      throw new UnprocessableEntityException({
        message: 'This OD approval has already been reviewed',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const updated = await this.prisma.od_request_hod_approvals.update({
      where: { id },
      data: {
        status: dto.decision,
        hod_user_id: userId,
        reviewed_at: new Date(),
      },
      select: HOD_APPROVAL_SELECT,
    });

    this.logger.log(
      `OD HoD approval ${id} ${dto.decision} by faculty=${hod.id} (department=${hod.department_id})`,
    );

    try {
      await this.notificationsService.create({
        user_id: updated.students.users.id,
        title: 'On-duty request update',
        message: `Your department HoD has ${dto.decision} your on-duty request "${updated.od_requests.reason ?? ''}".`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to notify student for OD approval ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return toResponse(updated);
  }

  private async resolveHodByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
