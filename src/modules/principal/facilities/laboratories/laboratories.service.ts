import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface VenueRow {
  id: number;
  name: string;
  location: string | null;
  capacity: number | null;
}

/** Same query.md #1 dependency as Classrooms — see classrooms.service.ts's doc comment. */
@Injectable()
export class PrincipalLaboratoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    try {
      const rooms = await this.prisma.$queryRaw<VenueRow[]>`
        SELECT id, name, location, capacity FROM venues WHERE venue_type = 'lab' ORDER BY name ASC
      `;
      return {
        tracked: true,
        total: rooms.length,
        labs: rooms.map((r) => ({
          id: r.id,
          block: r.location,
          room_number: r.name,
          capacity: r.capacity,
          department_in_charge: null,
        })),
      };
    } catch {
      return { tracked: false, total: 0, labs: [] };
    }
  }
}
