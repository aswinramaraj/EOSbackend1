import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApplyOdDto } from './dto/apply-od.dto';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

function overallStatus(hod: string, hr: string, principal: string | null): ApprovalStatus {
  if (hod === 'rejected' || hr === 'rejected' || principal === 'rejected') return 'rejected';
  if (hod === 'approved' && hr === 'approved' && (principal === 'approved' || principal === null)) return 'approved';
  return 'pending';
}

/**
 * Staff OD — the real, pre-existing `faculty_od_requests` table (in
 * schema.prisma). `staff_user_id` (added alongside the original faculty_id,
 * now nullable) is the generic non-teaching-staff column this needs — no
 * new table, no fake faculty record.
 */
@Injectable()
export class MediaRoomOdService {
  private readonly logger = new Logger(MediaRoomOdService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findHistory(userId: number, status?: string) {
    try {
      const rows = await this.prisma.faculty_od_requests.findMany({
        where: { staff_user_id: userId },
        orderBy: { created_at: 'desc' },
      });
      const data = rows
        .map((r) => ({
          id: r.id,
          from_date: r.from_date,
          to_date: r.to_date,
          purpose: r.purpose,
          organization_visited: r.organization_visited,
          od_type: r.od_type,
          hod_approval_status: r.hod_approval_status,
          hr_approval_status: r.hr_approval_status,
          principal_approval_status: r.principal_approval_status,
          verification_status: r.verification_status,
          periods_affected: r.periods_affected,
          class_adjustment: r.class_adjustment,
          created_at: r.created_at,
          overall_status: overallStatus(r.hod_approval_status, r.hr_approval_status, r.principal_approval_status),
        }))
        .filter((r) => !status || r.overall_status === status);
      return { ready: true, data };
    } catch (err) {
      this.logger.error('DB error listing OD history', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async apply(dto: ApplyOdDto, userId: number) {
    try {
      const row = await this.prisma.faculty_od_requests.create({
        data: {
          staff_user_id: userId,
          from_date: new Date(dto.from_date),
          to_date: new Date(dto.to_date),
          purpose: dto.purpose,
          organization_visited: dto.organization_visited,
          od_type: dto.od_type,
          periods_affected: dto.periods_affected,
          class_adjustment: dto.class_adjustment,
        },
      });
      return { id: row.id };
    } catch (err) {
      this.logger.error('DB error creating OD request', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
