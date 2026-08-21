import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface VenueRow {
  id: number;
  name: string;
  location: string | null;
  capacity: number | null;
}

/**
 * `venues.venue_type` and `timetable_slots.venue_id` are real (query.md #1
 * ran) — still read via `$queryRaw` rather than the typed client, since
 * this predates the `prisma db pull` that synced them into schema.prisma;
 * fine to convert to typed calls whenever this file is next touched.
 * CLASS HELD/CLASS ADVISOR/CONTACT need more than the venue_type column —
 * they also need `timetable_slots.venue_id` actually backfilled per period
 * — so even once venue_type exists, those four columns stay honestly "—"
 * until real timetable-to-room assignments exist too.
 */
@Injectable()
export class PrincipalClassroomsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    try {
      const rooms = await this.prisma.$queryRaw<VenueRow[]>`
        SELECT id, name, location, capacity FROM venues WHERE venue_type = 'classroom' ORDER BY name ASC
      `;
      const blocks = new Set(rooms.map((r) => r.location).filter(Boolean));
      return {
        tracked: true,
        total: rooms.length,
        blocks_count: blocks.size,
        rooms: rooms.map((r) => ({
          id: r.id,
          block: r.location,
          room_number: r.name,
          capacity: r.capacity,
          class_held: null,
          class_advisor: null,
          contact: null,
          facility: null,
        })),
      };
    } catch {
      return { tracked: false, total: 0, blocks_count: 0, rooms: [] };
    }
  }
}
