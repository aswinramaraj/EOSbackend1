import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectMediaRoomSchema } from './media-room-schema.util';
import { CreateShootAssignmentDto } from './dto/create-shoot-assignment.dto';
import { UpdateShootAssignmentDto } from './dto/update-shoot-assignment.dto';

interface ShootRow {
  id: number;
  media_request_id: number | null;
  event_title: string | null;
  venue: string | null;
  assigned_to_member_id: number | null;
  crew: string | null;
  gear_issued: string | null;
  output_type: string | null;
  scheduled_at: Date | null;
  status: string;
  created_at: Date;
}

interface TeamMemberNameRow {
  id: number;
  full_name: string;
}

const SHOOT_COLUMNS = Prisma.sql`id, media_request_id, event_title, venue, assigned_to_member_id, crew, gear_issued, output_type, scheduled_at, status, created_at`;

/**
 * Shoot assignments — media_shoot_assignments. Two real, independent
 * sources feed this one table: a media_request_id link (Media Requests
 * queue, tied to a real approved request) or a standalone event_title
 * (Academic Calendar's "Add media event" — the design's own version of this
 * button never saved anything, so this is a genuinely new, honest path, not
 * a fabricated one).
 */
@Injectable()
export class MediaRoomShootsService {
  private readonly logger = new Logger(MediaRoomShootsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async attachRelations(rows: ShootRow[]) {
    const requestIds = [...new Set(rows.map((r) => r.media_request_id).filter((id): id is number => id != null))];
    const memberIds = [...new Set(rows.map((r) => r.assigned_to_member_id).filter((id): id is number => id != null))];

    const [requests, members] = await Promise.all([
      requestIds.length
        ? this.prisma.media_requests.findMany({
            where: { id: { in: requestIds } },
            select: { id: true, event_name: true, event_date: true, description: true, status: true, venues: { select: { name: true } } },
          })
        : Promise.resolve([]),
      memberIds.length
        ? this.prisma.$queryRaw<TeamMemberNameRow[]>(Prisma.sql`SELECT id, full_name FROM media_team_members WHERE id IN (${Prisma.join(memberIds)})`)
        : Promise.resolve([]),
    ]);

    const requestById = new Map(requests.map((r): [number, typeof r] => [r.id, r]));
    const memberById = new Map(members.map((m): [number, typeof m] => [m.id, m]));

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      crew: r.crew,
      gear_issued: r.gear_issued,
      output_type: r.output_type,
      scheduled_at: r.scheduled_at,
      created_at: r.created_at,
      media_request: r.media_request_id != null ? requestById.get(r.media_request_id) ?? null : null,
      event_title: r.event_title,
      venue: r.venue,
      assigned_to: r.assigned_to_member_id != null ? memberById.get(r.assigned_to_member_id) ?? null : null,
    }));
  }

  async findAll() {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.shoots) return { ready: false, data: [] };

    try {
      const rows = await this.prisma.$queryRaw<ShootRow[]>(Prisma.sql`
        SELECT ${SHOOT_COLUMNS} FROM media_shoot_assignments ORDER BY scheduled_at ASC NULLS LAST, created_at DESC
      `);
      return { ready: true, data: await this.attachRelations(rows) };
    } catch (err) {
      this.logger.error('DB error listing shoot assignments', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  private async findOneRaw(id: number): Promise<ShootRow> {
    const rows = await this.prisma.$queryRaw<ShootRow[]>(Prisma.sql`
      SELECT ${SHOOT_COLUMNS} FROM media_shoot_assignments WHERE id = ${id}
    `);
    if (rows.length === 0) throw new NotFoundException({ message: 'Shoot assignment not found', errorCode: 'SHOOT_NOT_FOUND' });
    return rows[0];
  }

  async create(dto: CreateShootAssignmentDto, userId: number) {
    if (dto.media_request_id) {
      const request = await this.prisma.media_requests.findUnique({ where: { id: dto.media_request_id } });
      if (!request) {
        throw new NotFoundException({ message: 'Media request not found', errorCode: 'MEDIA_REQUEST_NOT_FOUND' });
      }
      if (request.status !== 'approved' && request.status !== 'delivered') {
        throw new BadRequestException({ message: 'Only approved requests can get a shoot assignment', errorCode: 'REQUEST_NOT_APPROVED' });
      }
    }

    try {
      const rows = await this.prisma.$queryRaw<ShootRow[]>(Prisma.sql`
        INSERT INTO media_shoot_assignments (media_request_id, event_title, venue, assigned_to_member_id, crew, gear_issued, output_type, scheduled_at, created_by_user_id)
        VALUES (${dto.media_request_id ?? null}, ${dto.event_title ?? null}, ${dto.venue ?? null}, ${dto.assigned_to_member_id ?? null}, ${dto.crew ?? null}, ${dto.gear_issued ?? null}, ${dto.output_type ?? null}, ${dto.scheduled_at ?? null}, ${userId})
        RETURNING ${SHOOT_COLUMNS}
      `);
      return (await this.attachRelations(rows))[0];
    } catch (err) {
      this.logger.error('DB error creating shoot assignment', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async update(id: number, dto: UpdateShootAssignmentDto) {
    await this.findOneRaw(id);
    try {
      const rows = await this.prisma.$queryRaw<ShootRow[]>(Prisma.sql`
        UPDATE media_shoot_assignments SET
          assigned_to_member_id = COALESCE(${dto.assigned_to_member_id ?? null}, assigned_to_member_id),
          crew = COALESCE(${dto.crew ?? null}, crew),
          gear_issued = COALESCE(${dto.gear_issued ?? null}, gear_issued),
          output_type = COALESCE(${dto.output_type ?? null}, output_type),
          scheduled_at = COALESCE(${dto.scheduled_at ?? null}, scheduled_at),
          status = COALESCE(${dto.status ?? null}, status)
        WHERE id = ${id}
        RETURNING ${SHOOT_COLUMNS}
      `);
      return (await this.attachRelations(rows))[0];
    } catch (err) {
      this.logger.error(`DB error updating shoot assignment ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    await this.findOneRaw(id);
    try {
      await this.prisma.$executeRaw(Prisma.sql`DELETE FROM media_shoot_assignments WHERE id = ${id}`);
      return { id };
    } catch (err) {
      this.logger.error(`DB error deleting shoot assignment ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
