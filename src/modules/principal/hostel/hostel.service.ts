import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * `hostel_settings.curfew_time` (query.md #8) doesn't exist yet — no
 * curfew/roll-call field exists anywhere in this schema. Read via
 * `$queryRaw` with a try/catch fallback so this module works today (no
 * roll-call line) and upgrades automatically the moment the admin runs
 * that SQL.
 *
 * Room-type fees (query.md #7, originally proposed as a new
 * `hostel_room_type_fees` table) turned out to already exist:
 * `hostel_room_types.fee_amount` is real and populated (2 real rows,
 * ₹95,000/₹1,10,000) — read directly via the typed Prisma client below,
 * no raw SQL/migration needed.
 */
@Injectable()
export class PrincipalHostelService {
  constructor(private readonly prisma: PrismaService) {}

  private async curfewTime(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        { curfew_time: string | null }[]
      >`
        SELECT curfew_time FROM hostel_settings LIMIT 1
      `;
      return rows[0]?.curfew_time ?? null;
    } catch {
      return null;
    }
  }

  private async outOnPassStudentIds(): Promise<Set<number>> {
    const today = startOfToday();
    const rows = await this.prisma.hostel_outings.findMany({
      where: {
        status: 'approved',
        from_date: { lte: today },
        to_date: { gte: today },
      },
      select: { student_id: true },
    });
    return new Set(rows.map((r) => r.student_id));
  }

  /** GET /me/principal/hostel/summary */
  async summary() {
    const [blocksCount, rooms, occupied, curfewTime] = await Promise.all([
      this.prisma.hostel_blocks.count(),
      this.prisma.hostel_rooms.findMany({ select: { capacity: true } }),
      this.prisma.student_hostel_mapping.count(),
      this.curfewTime(),
    ]);

    const capacity = rooms.reduce((sum, r) => sum + r.capacity, 0);

    return {
      blocks_count: blocksCount,
      rooms_count: rooms.length,
      capacity_total: capacity,
      occupied,
      vacant: capacity - occupied,
      occupancy_percentage:
        capacity > 0 ? round1((occupied / capacity) * 100) : null,
      curfew_time: curfewTime,
    };
  }

  /**
   * GET /me/principal/hostel/blocks
   *
   * "Out on pass" reuses the same "approved outing covering today" pattern
   * already validated in ResidentsService/HostelDashboardService — it means
   * "authorized to be away right now", not a confirmed gate-swipe count
   * (hostel_outings has no true in/out state). If a block has more than one
   * warden row, super_warden is preferred for display over sub_warden.
   */
  async blocks() {
    const [blocks, outOnPassIds] = await Promise.all([
      this.prisma.hostel_blocks.findMany({
        select: {
          id: true,
          name: true,
          hostels: { select: { id: true, name: true } },
          hostel_wardens: { select: { name: true, role: true } },
          hostel_rooms: {
            select: {
              capacity: true,
              student_hostel_mapping: { select: { student_id: true } },
            },
          },
        },
        orderBy: [{ hostel_id: 'asc' }, { name: 'asc' }],
      }),
      this.outOnPassStudentIds(),
    ]);

    return blocks.map((block) => {
      const capacity = block.hostel_rooms.reduce(
        (sum, r) => sum + r.capacity,
        0,
      );
      const occupantIds = block.hostel_rooms.flatMap((r) =>
        r.student_hostel_mapping.map((m) => m.student_id),
      );
      const occupied = occupantIds.length;
      const warden =
        block.hostel_wardens.find((w) => w.role === 'super_warden') ??
        block.hostel_wardens[0] ??
        null;

      return {
        id: block.id,
        name: block.name,
        hostel: block.hostels,
        warden: warden ? { name: warden.name, role: warden.role } : null,
        rooms_count: block.hostel_rooms.length,
        capacity,
        occupied,
        vacant: capacity - occupied,
        out_on_pass: occupantIds.filter((id) => outOnPassIds.has(id)).length,
      };
    });
  }

  /** GET /me/principal/hostel/room-type-fees */
  async roomTypeFees() {
    const roomTypes = await this.prisma.hostel_room_types.findMany({
      select: { id: true, name: true, fee_amount: true },
      orderBy: { name: 'asc' },
    });

    return roomTypes.map((rt) => ({
      room_type_id: rt.id,
      room_type: rt.name,
      total_per_year: rt.fee_amount,
    }));
  }
}
