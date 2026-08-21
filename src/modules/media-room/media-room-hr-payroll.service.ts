import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateHrPayrollRequestDto } from './dto/create-hr-payroll-request.dto';

/** HR/Payroll queries — the real, pre-existing `hr_payroll_requests` table (in schema.prisma), previously unused by any module. Generic requested_by_user_id, so no new table needed. */
@Injectable()
export class MediaRoomHrPayrollService {
  private readonly logger = new Logger(MediaRoomHrPayrollService.name);

  constructor(private readonly prisma: PrismaService) {}

  private static readonly ASSIGNEE_SELECT = {
    select: {
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  } as const;

  /** Same faculty-then-non_teaching_staff-then-email fallback used everywhere else a real name is preferred over an email. */
  private resolveAssigneeName(
    assignee: {
      email: string;
      faculty: { first_name: string; last_name: string } | null;
      non_teaching_staff: { first_name: string; last_name: string | null }[];
    } | null,
  ): string | null {
    if (!assignee) return null;
    if (assignee.faculty) return `${assignee.faculty.first_name} ${assignee.faculty.last_name}`;
    const staff = assignee.non_teaching_staff[0];
    if (staff) return staff.last_name ? `${staff.first_name} ${staff.last_name}` : staff.first_name;
    return assignee.email;
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
      category: row.category,
      subject: row.subject,
      description: row.description,
      attachment_url: row.attachment_url,
      status: row.status,
      hr_assigned_name: this.resolveAssigneeName(row.users_hr_payroll_requests_assigned_hr_user_idTousers),
      resolution_note: row.resolution_note,
      resolved_at: row.resolved_at,
      created_at: row.created_at,
    };
  }

  async findMine(userId: number) {
    try {
      const rows = await this.prisma.hr_payroll_requests.findMany({
        where: { requested_by_user_id: userId },
        include: { users_hr_payroll_requests_assigned_hr_user_idTousers: MediaRoomHrPayrollService.ASSIGNEE_SELECT },
        orderBy: { created_at: 'desc' },
      });
      return rows.map((r) => this.toResponse(r));
    } catch (err) {
      this.logger.error('DB error listing HR/payroll requests', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async create(dto: CreateHrPayrollRequestDto, userId: number) {
    try {
      const row = await this.prisma.hr_payroll_requests.create({
        data: {
          requested_by_user_id: userId,
          category: dto.category,
          subject: dto.subject,
          description: dto.description,
          attachment_url: dto.attachment_url,
        },
        include: { users_hr_payroll_requests_assigned_hr_user_idTousers: MediaRoomHrPayrollService.ASSIGNEE_SELECT },
      });
      return this.toResponse(row);
    } catch (err) {
      this.logger.error('DB error creating HR/payroll request', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
