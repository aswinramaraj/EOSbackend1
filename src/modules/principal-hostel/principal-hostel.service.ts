import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface BlockRow {
  id: number;
  name: string;
  wing: string;
  warden_name: string | null;
}
interface BedsRow {
  block_id: number;
  sanctioned: bigint;
}
interface OccupiedRow {
  block_id: number;
  occupied: bigint;
}
interface TotalsRow {
  sanctioned: bigint;
  occupied: bigint;
}

/** Principal-only Hostel occupancy overview (beds/warden only). */
@Injectable()
export class PrincipalHostelService {
  private readonly logger = new Logger(PrincipalHostelService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const blockRows = await this.prisma.$queryRaw<BlockRow[]>(Prisma.sql`
        SELECT hb.id, hb.name, h.wing::text AS wing,
          (
            SELECT hw.name FROM hostel_wardens hw
            WHERE hw.block_id = hb.id
            ORDER BY (hw.role = 'super_warden') DESC, hw.id ASC
            LIMIT 1
          ) AS warden_name
        FROM hostel_blocks hb
        JOIN hostels h ON h.id = hb.hostel_id
        ORDER BY h.wing ASC, hb.name ASC
      `);

      const bedsRows = await this.prisma.$queryRaw<BedsRow[]>(Prisma.sql`
        SELECT block_id, SUM(capacity)::bigint AS sanctioned
        FROM hostel_rooms
        WHERE block_id IS NOT NULL
        GROUP BY block_id
      `);

      const occupiedRows = await this.prisma.$queryRaw<OccupiedRow[]>(Prisma.sql`
        SELECT hr.block_id, COUNT(*)::bigint AS occupied
        FROM student_hostel_mapping shm
        JOIN hostel_rooms hr ON hr.id = shm.room_id
        WHERE hr.block_id IS NOT NULL
        GROUP BY hr.block_id
      `);

      const totalsRows = await this.prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
        SELECT
          (SELECT COALESCE(SUM(capacity), 0) FROM hostel_rooms)::bigint AS sanctioned,
          (SELECT COUNT(*) FROM student_hostel_mapping)::bigint AS occupied
      `);

      const bedsMap = new Map(bedsRows.map((r) => [r.block_id, Number(r.sanctioned)]));
      const occupiedMap = new Map(occupiedRows.map((r) => [r.block_id, Number(r.occupied)]));

      const totals = totalsRows[0];
      const totalSanctioned = Number(totals?.sanctioned ?? 0);
      const totalOccupied = Number(totals?.occupied ?? 0);

      return {
        block_count: blockRows.length,
        beds_sanctioned: totalSanctioned,
        occupied: totalOccupied,
        vacant: Math.max(totalSanctioned - totalOccupied, 0),
        occupancy_pct: totalSanctioned > 0 ? Math.round((totalOccupied / totalSanctioned) * 1000) / 10 : null,
        blocks: blockRows.map((block) => {
          const sanctioned = bedsMap.get(block.id) ?? 0;
          const occupied = occupiedMap.get(block.id) ?? 0;
          return {
            id: block.id,
            name: block.name,
            wing: block.wing,
            warden_name: block.warden_name,
            beds_sanctioned: sanctioned,
            occupied,
            vacant: Math.max(sanctioned - occupied, 0),
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error computing principal hostel overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
