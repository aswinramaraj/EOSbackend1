import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class HostelDashboardService {
  private readonly logger = new Logger(HostelDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /hostel/dashboard/summary
   *
   * "On leave" / "currently present" split matches the same approved-outing
   * definition used by ResidentsService — no separate "day pass" vs "home
   * leave" distinction exists in the schema (hostel_outings has one status
   * enum, not an outing-type field), so this doesn't split them into
   * separate tiles the way the design mockup does.
   *
   * `hostelId` scopes every count to one hostel (a warden's own) — omit for
   * the institution-wide view (admin).
   */
  async summary(hostelId?: number | null) {
    const now = new Date();
    const hostel =
      hostelId != null
        ? await this.prisma.hostels.findUnique({
            where: { id: hostelId },
            select: { id: true, name: true, code: true, wing: true },
          })
        : null;
    const outingScope =
      hostelId != null
        ? {
            students: {
              student_hostel_mapping: { hostel_rooms: { hostel_id: hostelId } },
            },
          }
        : {};

    try {
      const [
        totalResidents,
        onLeaveCount,
        pendingApprovals,
        roomAggregate,
        openComplaints,
      ] = await this.prisma.$transaction([
        this.prisma.student_hostel_mapping.count({
          where: hostelId != null ? { hostel_rooms: { hostel_id: hostelId } } : {},
        }),
        this.prisma.hostel_outings.count({
          where: {
            status: 'approved',
            from_date: { lte: now },
            to_date: { gte: now },
            ...outingScope,
          },
        }),
        this.prisma.hostel_outings.count({
          where: { status: 'pending', ...outingScope },
        }),
        this.prisma.hostel_rooms.aggregate({
          _sum: { capacity: true },
          where: hostelId != null ? { hostel_id: hostelId } : {},
        }),
        this.prisma.hostel_complaints.count({
          where: {
            status: { in: ['open', 'in_progress'] },
            ...(hostelId != null ? { hostel_id: hostelId } : {}),
          },
        }),
      ]);

      // Every resident occupies exactly one bed via their mapping row, so
      // "beds occupied" is the same count as "total residents" — no
      // separate query needed for it.
      const bedsTotal = roomAggregate._sum.capacity ?? 0;
      const bedsOccupied = totalResidents;

      return {
        hostel,
        total_residents: totalResidents,
        currently_present: totalResidents - onLeaveCount,
        on_leave: onLeaveCount,
        pending_approvals: pendingApprovals,
        beds_total: bedsTotal,
        beds_occupied: bedsOccupied,
        beds_vacant: bedsTotal - bedsOccupied,
        occupancy_pct:
          bedsTotal > 0
            ? Math.round((bedsOccupied / bedsTotal) * 1000) / 10
            : 0,
        complaints_open: openComplaints,
      };
    } catch (err) {
      this.logger.error(
        'DB error while computing hostel dashboard summary',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
