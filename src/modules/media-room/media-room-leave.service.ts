import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApplyLeaveDto } from './dto/apply-leave.dto';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

function overallStatus(hod: string, hr: string, principal: string | null): ApprovalStatus {
  if (hod === 'rejected' || hr === 'rejected' || principal === 'rejected') return 'rejected';
  if (hod === 'approved' && hr === 'approved' && (principal === 'approved' || principal === null)) return 'approved';
  return 'pending';
}

interface DeciderRelation {
  email: string;
  faculty: { first_name: string; last_name: string } | null;
}

/** Same faculty-first/email-fallback pattern used everywhere else a decider/poster needs a display name. */
function resolveDeciderName(decider: DeciderRelation | null): string | null {
  if (!decider) return null;
  return decider.faculty ? `${decider.faculty.first_name} ${decider.faculty.last_name}` : decider.email;
}

const DECIDER_SELECT = { select: { email: true, faculty: { select: { first_name: true, last_name: true } } } } as const;

/**
 * Staff leave — the real, pre-existing `faculty_leaves` / `leave_types`
 * tables (in schema.prisma). `faculty_leaves.staff_user_id` (added
 * alongside the original faculty_id in a later migration) is exactly the
 * generic non-teaching-staff column this needs — no new table, no fake
 * faculty record. `faculty_leave_balances` was NOT generalized the same
 * way (still faculty_id-only, no staff_user_id), so balances here are
 * computed from real leave_types quotas minus real approved faculty_leaves
 * rows, rather than read from that table.
 */
@Injectable()
export class MediaRoomLeaveService {
  private readonly logger = new Logger(MediaRoomLeaveService.name);

  constructor(private readonly prisma: PrismaService) {}

  findTypes() {
    return this.prisma.leave_types.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } });
  }

  async findBalances(userId: number) {
    const types = await this.findTypes();
    const year = new Date().getFullYear();

    const approved = await this.prisma.faculty_leaves.findMany({
      where: {
        staff_user_id: userId,
        hod_approval_status: 'approved',
        hr_approval_status: 'approved',
        from_date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
      },
      select: { leave_type_id: true, from_date: true, to_date: true },
    });

    const usedByType = new Map<number, number>();
    for (const r of approved) {
      if (r.leave_type_id == null) continue;
      const days = Math.round((r.to_date.getTime() - r.from_date.getTime()) / 86_400_000) + 1;
      usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) ?? 0) + days);
    }

    return types.map((t) => {
      const used = usedByType.get(t.id) ?? 0;
      return { leave_type_id: t.id, leave_type: t.name, allocated: t.default_annual_quota, used, remaining: Math.max(0, t.default_annual_quota - used) };
    });
  }

  async findHistory(userId: number, status?: string) {
    try {
      const rows = await this.prisma.faculty_leaves.findMany({
        where: { staff_user_id: userId },
        include: {
          leave_types: { select: { id: true, name: true } },
          users_faculty_leaves_hod_decided_by_user_idTousers: DECIDER_SELECT,
          users_faculty_leaves_hr_decided_by_user_idTousers: DECIDER_SELECT,
        },
        orderBy: { created_at: 'desc' },
      });
      const data = rows
        .map((r) => ({
          id: r.id,
          from_date: r.from_date,
          to_date: r.to_date,
          reason: r.reason,
          attachment_url: r.attachment_url,
          leave_type: r.leave_types,
          hod_approval_status: r.hod_approval_status,
          hr_approval_status: r.hr_approval_status,
          principal_approval_status: r.principal_approval_status,
          hod_decided_at: r.hod_decided_at,
          hod_decided_by: resolveDeciderName(r.users_faculty_leaves_hod_decided_by_user_idTousers),
          hod_remarks: r.hod_remarks,
          hr_decided_at: r.hr_decided_at,
          hr_decided_by: resolveDeciderName(r.users_faculty_leaves_hr_decided_by_user_idTousers),
          hr_remarks: r.hr_remarks,
          created_at: r.created_at,
          overall_status: overallStatus(r.hod_approval_status, r.hr_approval_status, r.principal_approval_status),
        }))
        .filter((r) => !status || r.overall_status === status);
      return { ready: true, data };
    } catch (err) {
      this.logger.error('DB error listing leave history', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async apply(dto: ApplyLeaveDto, userId: number) {
    try {
      const row = await this.prisma.faculty_leaves.create({
        data: {
          staff_user_id: userId,
          leave_type_id: dto.leave_type_id,
          from_date: new Date(dto.from_date),
          to_date: new Date(dto.to_date),
          reason: dto.reason,
          alternate_arrangement: dto.alternate_arrangement,
          is_station_leave: dto.is_station_leave ?? false,
          attachment_url: dto.attachment_url,
        },
      });
      const days = Math.round((new Date(dto.to_date).getTime() - new Date(dto.from_date).getTime()) / 86_400_000) + 1;
      return { id: row.id, days };
    } catch (err) {
      this.logger.error('DB error creating leave request', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
