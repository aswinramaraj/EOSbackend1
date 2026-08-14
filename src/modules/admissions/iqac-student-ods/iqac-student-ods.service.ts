import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ListIqacStudentOdQueryDto } from './dto/list-iqac-student-od-query.dto';
import { VerifyStudentOdDto } from './dto/verify-student-od.dto';

/**
 * Prisma's default $transaction maxWait (2000ms) is too tight for this
 * project's Supabase pooler round-trip under real-world latency — the batch
 * $transaction below was observed failing at a hard ~2.0-2.3s ceiling
 * ("Unable to start a transaction in the given time"), not intermittently,
 * so this raises the budget rather than papering over a one-off blip.
 */
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 15000 };

const STUDENT_NAME_SELECT = {
  id: true,
  student_id_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { id: true, email: true } },
  classes: { select: { section: true, departments: { select: { id: true, name: true } } } },
} as const;

interface StudentNameRow {
  id: number;
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { id: number; email: string };
  classes: { section: string; departments: { id: number; name: string } } | null;
}

/** Same fallback chain used everywhere else in this codebase - no generic display-name column on `students`. */
function resolveStudentName(student: StudentNameRow): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

const OD_REQUEST_LIST_SELECT = {
  id: true,
  team_id: true,
  from_date: true,
  to_date: true,
  from_time: true,
  to_time: true,
  reason: true,
  organization: true,
  location: true,
  mentor_approval_status: true,
  verification_status: true,
  photo_url: true,
  certificate_url: true,
  admin_remarks: true,
  created_at: true,
  od_teams: {
    select: {
      unique_code: true,
      od_team_members: { select: { student_id: true } },
      students: { select: STUDENT_NAME_SELECT },
    },
  },
} as const;

const OD_REQUEST_DETAIL_SELECT = {
  ...OD_REQUEST_LIST_SELECT,
  latitude: true,
  longitude: true,
  photo_uploaded_at: true,
  certificate_uploaded_at: true,
  email_sender: true,
  email_receiver: true,
  email_subject: true,
  email_sent_at: true,
  email_body: true,
  faculty: { select: { first_name: true, last_name: true } },
  od_request_hod_approvals: {
    select: {
      id: true,
      status: true,
      reviewed_at: true,
      departments: { select: { name: true } },
      students: { select: STUDENT_NAME_SELECT },
    },
  },
  od_teams: {
    select: {
      unique_code: true,
      students: { select: STUDENT_NAME_SELECT },
      od_team_members: {
        select: { student_id: true, students: { select: STUDENT_NAME_SELECT } },
      },
    },
  },
} as const;

interface OdRequestListRow {
  id: number;
  team_id: number;
  from_date: Date;
  to_date: Date;
  from_time: Date | null;
  to_time: Date | null;
  reason: string | null;
  organization: string | null;
  location: string | null;
  mentor_approval_status: string;
  verification_status: string;
  photo_url: string | null;
  certificate_url: string | null;
  admin_remarks: string | null;
  created_at: Date;
  od_teams: {
    unique_code: string;
    od_team_members: { student_id: number }[];
    students: StudentNameRow;
  };
}

interface OdRequestDetailRow
  extends Omit<OdRequestListRow, 'od_teams'> {
  latitude: unknown;
  longitude: unknown;
  photo_uploaded_at: Date | null;
  certificate_uploaded_at: Date | null;
  email_sender: string | null;
  email_receiver: string | null;
  email_subject: string | null;
  email_sent_at: Date | null;
  email_body: string | null;
  faculty: { first_name: string; last_name: string } | null;
  od_request_hod_approvals: {
    id: number;
    status: string;
    reviewed_at: Date | null;
    departments: { name: string };
    students: StudentNameRow;
  }[];
  od_teams: {
    unique_code: string;
    students: StudentNameRow;
    od_team_members: { student_id: number; students: StudentNameRow }[];
  };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTime(time: Date | null): string | null {
  return time ? time.toISOString().slice(11, 16) : null;
}

function toListResponse(row: OdRequestListRow) {
  const creator = row.od_teams.students;
  return {
    id: row.id,
    team_id: row.team_id,
    unique_code: row.od_teams.unique_code,
    member_count: row.od_teams.od_team_members.length,
    creator: {
      id: creator.id,
      student_id_no: creator.student_id_no,
      name: resolveStudentName(creator),
      section: creator.classes?.section ?? null,
      department_id: creator.classes?.departments.id ?? null,
      department_name: creator.classes?.departments.name ?? null,
    },
    from_date: toDateOnly(row.from_date),
    to_date: toDateOnly(row.to_date),
    reason: row.reason,
    organization: row.organization,
    location: row.location,
    mentor_approval_status: row.mentor_approval_status,
    verification_status: row.verification_status,
    photo_url: row.photo_url,
    certificate_url: row.certificate_url,
    admin_remarks: row.admin_remarks,
    created_at: row.created_at,
  };
}

function toDetailResponse(row: OdRequestDetailRow) {
  const list = toListResponse(row);
  return {
    ...list,
    from_time: formatTime(row.from_time),
    to_time: formatTime(row.to_time),
    latitude: row.latitude,
    longitude: row.longitude,
    photo_uploaded_at: row.photo_uploaded_at,
    certificate_uploaded_at: row.certificate_uploaded_at,
    faculty_guide_name: row.faculty
      ? `${row.faculty.first_name} ${row.faculty.last_name}`.trim()
      : null,
    email: {
      sender: row.email_sender,
      receiver: row.email_receiver,
      subject: row.email_subject,
      sent_at: row.email_sent_at,
      body: row.email_body,
    },
    team_members: row.od_teams.od_team_members.map((m) => ({
      student_id: m.student_id,
      name: resolveStudentName(m.students),
      student_id_no: m.students.student_id_no,
      section: m.students.classes?.section ?? null,
    })),
    hod_approvals: row.od_request_hod_approvals.map((a) => ({
      id: a.id,
      status: a.status,
      reviewed_at: a.reviewed_at,
      department_name: a.departments.name,
      student_name: resolveStudentName(a.students),
    })),
  };
}

/**
 * IQAC's read-only-plus-verify view over student on-duty requests -
 * distinct from student-ods.service.ts (the mentor's own review queue,
 * scoped by class_mentors): this is unscoped by mentor, filterable by
 * department/date/status, and adds the verification_status the mentor
 * queue has no concept of. worflow.md: "IQAC can view informations of
 * On-Duty of students".
 */
@Injectable()
export class IqacStudentOdsService {
  private readonly logger = new Logger(IqacStudentOdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** GET /iqac/student-ods (IQAC only). */
  async findAll(query: ListIqacStudentOdQueryDto) {
    const where: Record<string, unknown> = {
      mentor_approval_status: query.mentor_approval_status,
      verification_status: query.verification_status,
    };

    if (query.from || query.to) {
      where.from_date = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    if (query.department_id) {
      where.od_teams = {
        students: { classes: { department_id: query.department_id } },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.od_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: OD_REQUEST_LIST_SELECT,
      }),
      this.prisma.od_requests.count({ where }),
    ], TRANSACTION_OPTIONS);

    return paginate(rows.map(toListResponse), total, query);
  }

  /** GET /iqac/student-ods/:id (IQAC only). Full detail. */
  async findOne(id: number) {
    const row = await this.prisma.od_requests.findUnique({
      where: { id },
      select: OD_REQUEST_DETAIL_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }
    return toDetailResponse(row);
  }

  /** PATCH /iqac/student-ods/:id/verify (IQAC only). */
  async verify(id: number, dto: VerifyStudentOdDto, userId: number) {
    const existing = await this.prisma.od_requests.findUnique({
      where: { id },
      select: { id: true, reason: true, od_teams: { select: { created_by_student_id: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }

    const updated = await this.prisma.od_requests.update({
      where: { id },
      data: {
        verification_status: dto.verification_status,
        admin_remarks: dto.admin_remarks,
      },
      select: OD_REQUEST_DETAIL_SELECT,
    });

    this.logger.log(
      `OD request ${id} verification set to ${dto.verification_status} by IQAC user=${userId}`,
    );

    try {
      const creator = await this.prisma.students.findUnique({
        where: { id: existing.od_teams.created_by_student_id },
        select: { users: { select: { id: true } } },
      });
      if (creator) {
        await this.notificationsService.create({
          user_id: creator.users.id,
          title: 'On-duty documents reviewed',
          message: `IQAC marked your on-duty request "${existing.reason ?? ''}" as ${dto.verification_status.replace('_', ' ')}.`,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to notify creator for OD request ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return toDetailResponse(updated);
  }
}
