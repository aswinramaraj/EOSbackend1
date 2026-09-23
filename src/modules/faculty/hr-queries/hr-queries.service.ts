import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { CreateHrQueryDto } from './dto/create-hr-query.dto';

/**
 * HR help-desk queries — backed by `hr_payroll_requests`, a REAL,
 * pre-existing table (requested_by_user_id, category, subject,
 * description, attachment_url, status, assigned_hr_user_id,
 * resolution_note, resolved_at, created_at, with real FKs to `users` for
 * both the requester and the assigned HR staff) that had ZERO backend code
 * anywhere referencing it before this — confirmed via `grep -rl
 * hr_payroll_requests src/modules` returning nothing. An earlier pass in
 * this session built a parallel `hr_queries` table via raw SQL before this
 * real table was discovered (via `npx prisma db pull` surfacing it) —
 * that table is now unused; drop it with `DROP TABLE hr_queries;` if you
 * want to clean it up, it's safe to remove.
 *
 * Real status values, confirmed directly from the live CHECK constraint
 * (hr_payroll_requests_status_check): 'submitted' | 'under_review' | 'resolved'.
 */
/**
 * Display name for the HR person a ticket is assigned to.
 *
 * faculty -> non_teaching_staff -> email, the order used across this codebase
 * (resolveRequesterName in media-requests.service.ts, resolveMarkerName in
 * attendance.service.ts). HR Payroll accounts are non_teaching_staff rows, so
 * without the middle step this fell straight through to showing the assignee's
 * raw email address to whoever raised the ticket.
 */
function resolveAssigneeName(
  assignee: {
    email: string;
    faculty: { first_name: string; last_name: string } | null;
    non_teaching_staff: { first_name: string; last_name: string | null }[];
  } | null,
): string | null {
  if (!assignee) return null;
  if (assignee.faculty) {
    return `${assignee.faculty.first_name} ${assignee.faculty.last_name}`;
  }
  // non_teaching_staff.user_id is nullable, so Prisma models it as a list.
  const staff = assignee.non_teaching_staff?.[0];
  if (staff) {
    return [staff.first_name, staff.last_name].filter(Boolean).join(' ');
  }
  return assignee.email;
}

/**
 * hr_payroll_requests.status is CHECK-constrained to 'submitted' |
 * 'under_review' | 'resolved' - there is no approved/rejected value. An HR
 * decision is stored as status 'resolved' with resolution_note prefixed
 * "Approved" / "Rejected", and read back through decisionFor() so callers
 * get a clean pending/approved/rejected without a schema change.
 */
const APPROVED_PREFIX = 'Approved';
const REJECTED_PREFIX = 'Rejected';

export type HrPayrollDecision = 'pending' | 'approved' | 'rejected';

function decisionFor(status: string, note: string | null): HrPayrollDecision {
  if (status !== 'resolved') return 'pending';
  return note?.startsWith(REJECTED_PREFIX) ? 'rejected' : 'approved';
}

/** Display identity for a requester: faculty -> non_teaching_staff -> email. */
function resolveRequester(user: {
  email: string;
  faculty: {
    first_name: string;
    last_name: string;
    designation: string | null;
    departments: { name: string } | null;
  } | null;
  non_teaching_staff: {
    first_name: string;
    last_name: string | null;
    departments: { name: string } | null;
  }[];
}) {
  if (user.faculty) {
    return {
      kind: 'faculty' as const,
      name: `${user.faculty.first_name} ${user.faculty.last_name}`,
      designation: user.faculty.designation,
      department: user.faculty.departments?.name ?? null,
    };
  }
  const staff = user.non_teaching_staff?.[0];
  if (staff) {
    return {
      kind: 'staff' as const,
      name: [staff.first_name, staff.last_name].filter(Boolean).join(' '),
      designation: 'Non-teaching staff',
      department: staff.departments?.name ?? null,
    };
  }
  return {
    kind: 'unknown' as const,
    name: user.email,
    designation: null,
    department: null,
  };
}

@Injectable()
export class HrQueriesService {
  private readonly logger = new Logger(HrQueriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private ticketNo(id: number, createdAt: Date): string {
    return `HRM-${createdAt.getFullYear()}-${id}`;
  }

  private toResponse(row: {
    id: number;
    category: string;
    subject: string;
    description: string | null;
    attachment_url: string | null;
    status: string;
    resolution_note: string | null;
    resolved_at: Date | null;
    created_at: Date;
    users_hr_payroll_requests_assigned_hr_user_idTousers: {
      email: string;
      faculty: { first_name: string; last_name: string } | null;
      non_teaching_staff: { first_name: string; last_name: string | null }[];
    } | null;
  }) {
    return {
      id: row.id,
      ticket_no: this.ticketNo(row.id, row.created_at),
      category: row.category,
      subject: row.subject,
      description: row.description,
      file_url: row.attachment_url,
      status: row.status,
      decision: decisionFor(row.status, row.resolution_note),
      assigned_to_name: resolveAssigneeName(
        row.users_hr_payroll_requests_assigned_hr_user_idTousers,
      ),
      resolved_at: row.resolved_at,
      resolution_note: row.resolution_note,
      created_at: row.created_at,
    };
  }

  /** POST /me/hr-queries (Faculty only) — multipart, file is optional. */
  async create(
    dto: CreateHrQueryDto,
    userId: number,
    file?: Express.Multer.File,
  ) {
    let attachmentUrl: string | null = null;
    if (file) {
      const { key } = await this.storage.upload(
        'hr-payroll-requests',
        file.originalname,
        file.buffer,
        file.mimetype,
      );
      attachmentUrl = this.storage.getPublicUrl(key);
    }

    const row = await this.prisma.hr_payroll_requests.create({
      data: {
        requested_by_user_id: userId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        attachment_url: attachmentUrl,
        status: 'submitted',
      },
    });

    this.logger.log(
      `HR payroll request submitted: id=${row.id} user=${userId}`,
    );

    return {
      id: row.id,
      ticket_no: this.ticketNo(row.id, row.created_at),
      status: row.status,
    };
  }

  /** GET /me/hr-queries (Faculty only — own requests). */
  async findMine(userId: number) {
    const rows = await this.prisma.hr_payroll_requests.findMany({
      where: { requested_by_user_id: userId },
      include: {
        users_hr_payroll_requests_assigned_hr_user_idTousers: {
          select: {
            email: true,
            // Without these the assignee's raw EMAIL ADDRESS was shown to
            // the requester as the assigned HR person's name.
            faculty: { select: { first_name: true, last_name: true } },
            non_teaching_staff: {
              select: { first_name: true, last_name: true },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return rows.map((r) => this.toResponse(r));
  }

  // ───────────── HR Payroll: review every staff member's requests ─────────────

  /** GET /hr/payroll-requests - every request, newest first, with the requester's identity. */
  async listForReview() {
    const rows = await this.prisma.hr_payroll_requests.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        users_hr_payroll_requests_requested_by_user_idTousers: {
          select: {
            email: true,
            faculty: {
              select: {
                first_name: true,
                last_name: true,
                designation: true,
                departments: { select: { name: true } },
              },
            },
            non_teaching_staff: {
              select: {
                first_name: true,
                last_name: true,
                departments: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      ticket_no: this.ticketNo(r.id, r.created_at),
      category: r.category,
      subject: r.subject,
      description: r.description,
      file_url: r.attachment_url,
      status: r.status,
      decision: decisionFor(r.status, r.resolution_note),
      resolution_note: r.resolution_note,
      resolved_at: r.resolved_at,
      created_at: r.created_at,
      requester: resolveRequester(
        r.users_hr_payroll_requests_requested_by_user_idTousers,
      ),
    }));
  }

  /** PATCH /hr/payroll-requests/:id/approve | :id/reject - one decision per request. */
  async decide(
    id: number,
    decision: 'approved' | 'rejected',
    hrUserId: number,
    note?: string,
  ) {
    const row = await this.prisma.hr_payroll_requests.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!row) {
      throw new NotFoundException({
        message: 'HR payroll request not found',
        errorCode: 'HR_PAYROLL_REQUEST_NOT_FOUND',
      });
    }
    if (row.status === 'resolved') {
      throw new ConflictException({
        message: 'This request has already been decided',
        errorCode: 'HR_PAYROLL_REQUEST_ALREADY_DECIDED',
      });
    }

    const prefix = decision === 'approved' ? APPROVED_PREFIX : REJECTED_PREFIX;
    const trimmed = note?.trim();
    // resolution_note is VARCHAR(255).
    const resolutionNote = (trimmed ? `${prefix}: ${trimmed}` : prefix).slice(
      0,
      255,
    );

    const updated = await this.prisma.hr_payroll_requests.update({
      where: { id },
      data: {
        status: 'resolved',
        resolution_note: resolutionNote,
        resolved_at: new Date(),
        assigned_hr_user_id: hrUserId,
      },
    });

    this.logger.log(
      `HR payroll request ${decision}: id=${id} by user=${hrUserId}`,
    );

    return {
      id: updated.id,
      status: updated.status,
      decision,
      resolution_note: updated.resolution_note,
    };
  }
}
