import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateShootAssignmentDto,
  UpdateShootAssignmentDto,
} from './dto/media-shoot.dto';
import { dateOnly, instant, readyList } from './serialize';

const SHOOT_SELECT = {
  id: true,
  status: true,
  crew: true,
  gear_issued: true,
  output_type: true,
  scheduled_at: true,
  created_at: true,
  event_title: true,
  venue: true,
  media_requests: {
    select: {
      id: true,
      event_name: true,
      event_date: true,
      description: true,
      status: true,
      venues: { select: { name: true } },
    },
  },
  media_team_members: { select: { id: true, full_name: true } },
} as const;

interface ShootRow {
  id: number;
  status: string;
  crew: string | null;
  gear_issued: string | null;
  output_type: string | null;
  scheduled_at: Date | null;
  created_at: Date;
  event_title: string | null;
  venue: string | null;
  media_requests: {
    id: number;
    event_name: string | null;
    event_date: Date | null;
    description: string;
    status: string;
    venues: { name: string } | null;
  } | null;
  media_team_members: { id: number; full_name: string } | null;
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

@Injectable()
export class MediaShootsService {
  private readonly logger = new Logger(MediaShootsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private shape(row: ShootRow) {
    return {
      id: row.id,
      status: row.status,
      crew: row.crew,
      gear_issued: row.gear_issued,
      output_type: row.output_type,
      scheduled_at: instant(row.scheduled_at),
      created_at: instant(row.created_at),
      event_title: row.event_title,
      venue: row.venue,
      media_request: row.media_requests
        ? {
            id: row.media_requests.id,
            event_name: row.media_requests.event_name,
            // event_date is a DATE column — emitted day-only so a shoot is
            // never shown against the previous day.
            event_date: dateOnly(row.media_requests.event_date),
            description: row.media_requests.description,
            status: row.media_requests.status,
            venues: row.media_requests.venues,
          }
        : null,
      assigned_to: row.media_team_members,
    };
  }

  /**
   * GET /me/media-shoot-assignments
   *
   * Ordered by the slot each shoot occupies rather than when it was entered,
   * so the board reads as a schedule. Unscheduled entries sort last instead of
   * displacing dated work.
   */
  async list() {
    const rows = await this.prisma.media_shoot_assignments.findMany({
      select: SHOOT_SELECT,
      orderBy: [{ scheduled_at: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
    });
    return readyList(rows.map((r) => this.shape(r)));
  }

  /**
   * POST /me/media-shoot-assignments
   *
   * A shoot is raised either against an existing media request or as a
   * standalone entry — the database enforces exactly one via a check
   * constraint, so both halves are validated here to return an explanation
   * rather than a raw constraint error.
   */
  async create(dto: CreateShootAssignmentDto, userId: number) {
    const hasRequest = dto.media_request_id !== undefined;
    const hasTitle =
      dto.event_title !== undefined && dto.event_title.length > 0;

    if (hasRequest === hasTitle) {
      throw new UnprocessableEntityException({
        message: hasRequest
          ? 'Give either a media request or a standalone event title, not both'
          : 'Give either a media request or a standalone event title',
        errorCode: 'SHOOT_SOURCE_INVALID',
      });
    }

    if (hasRequest) {
      const exists = await this.prisma.media_requests.count({
        where: { id: dto.media_request_id },
      });
      if (exists === 0) {
        throw new NotFoundException({
          message: 'Media request not found',
          errorCode: 'NOT_FOUND',
        });
      }
    }

    if (dto.assigned_to_member_id !== undefined) {
      await this.assertMemberExists(dto.assigned_to_member_id);
    }

    try {
      const row = await this.prisma.media_shoot_assignments.create({
        data: {
          media_request_id: dto.media_request_id,
          event_title: hasTitle ? dto.event_title : undefined,
          venue: hasTitle ? dto.venue : undefined,
          assigned_to_member_id: dto.assigned_to_member_id,
          crew: dto.crew,
          gear_issued: dto.gear_issued,
          output_type: dto.output_type,
          scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : undefined,
          created_by_user_id: userId,
        },
        select: SHOOT_SELECT,
      });
      this.logger.log('Media shoot created: id=' + row.id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      this.logger.error('DB error creating media shoot', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/media-shoot-assignments/:id */
  async update(id: number, dto: UpdateShootAssignmentDto, userId: number) {
    if (dto.assigned_to_member_id !== undefined) {
      await this.assertMemberExists(dto.assigned_to_member_id);
    }

    // A shoot raised against a media request takes its title and venue from
    // that request, so overwriting them here would silently contradict the
    // source it is tracking.
    if (dto.event_title !== undefined || dto.venue !== undefined) {
      const existing = await this.prisma.media_shoot_assignments.findUnique({
        where: { id },
        select: { media_request_id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          message: 'Shoot assignment not found',
          errorCode: 'NOT_FOUND',
        });
      }
      if (existing.media_request_id !== null) {
        throw new UnprocessableEntityException({
          message:
            'This shoot follows a media request; its title and venue come from that request',
          errorCode: 'SHOOT_SOURCE_IMMUTABLE',
        });
      }
    }

    try {
      const row = await this.prisma.media_shoot_assignments.update({
        where: { id },
        data: {
          assigned_to_member_id: dto.assigned_to_member_id,
          crew: dto.crew,
          gear_issued: dto.gear_issued,
          output_type: dto.output_type,
          scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : undefined,
          status: dto.status,
          event_title: dto.event_title,
          venue: dto.venue,
        },
        select: SHOOT_SELECT,
      });
      this.logger.log('Media shoot updated: id=' + id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Shoot assignment not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error updating media shoot #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/media-shoot-assignments/:id */
  async remove(id: number, userId: number) {
    try {
      await this.prisma.media_shoot_assignments.delete({ where: { id } });
      this.logger.log('Media shoot deleted: id=' + id + ' by user=' + userId);
      return { message: 'Shoot assignment deleted successfully' };
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Shoot assignment not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error deleting media shoot #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Rejects an assignment to a member who does not exist, which the FK would
   *  otherwise surface as an opaque server error. */
  private async assertMemberExists(memberId: number): Promise<void> {
    const exists = await this.prisma.media_team_members.count({
      where: { id: memberId },
    });
    if (exists === 0) {
      throw new NotFoundException({
        message: 'Team member not found',
        errorCode: 'NOT_FOUND',
      });
    }
  }
}
