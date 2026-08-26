import { Injectable, Logger } from '@nestjs/common';
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
}
