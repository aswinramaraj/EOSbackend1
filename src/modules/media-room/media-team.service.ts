import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateTeamMemberDto,
  UpdateTeamMemberDto,
} from './dto/media-team.dto';
import { dateOnly, instant, readyList } from './serialize';

const TEAM_SELECT = {
  id: true,
  full_name: true,
  designation: true,
  email: true,
  phone: true,
  skills: true,
  photo_url: true,
  status: true,
  joined_on: true,
  created_at: true,
} as const;

interface TeamRow {
  id: number;
  full_name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  skills: string | null;
  photo_url: string | null;
  status: string;
  joined_on: Date | null;
  created_at: Date;
}

function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value + 'T00:00:00.000Z');
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

@Injectable()
export class MediaTeamService {
  private readonly logger = new Logger(MediaTeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  private shape(row: TeamRow) {
    return {
      id: row.id,
      full_name: row.full_name,
      designation: row.designation,
      email: row.email,
      phone: row.phone,
      skills: row.skills,
      photo_url: row.photo_url,
      status: row.status,
      joined_on: dateOnly(row.joined_on),
      created_at: instant(row.created_at),
    };
  }

  /**
   * GET /me/media-team-members
   *
   * Active members first so the roster the team actually assigns work to is at
   * the top, with past members still reachable underneath rather than hidden.
   */
  async list() {
    const rows = await this.prisma.media_team_members.findMany({
      select: TEAM_SELECT,
      orderBy: [{ status: 'asc' }, { full_name: 'asc' }],
    });
    return readyList(rows.map((r) => this.shape(r)));
  }

  /** POST /me/media-team-members */
  async create(dto: CreateTeamMemberDto, userId: number) {
    try {
      const row = await this.prisma.media_team_members.create({
        data: {
          full_name: dto.full_name,
          designation: dto.designation,
          email: dto.email,
          phone: dto.phone,
          skills: dto.skills,
          photo_url: dto.photo_url,
          joined_on: toDate(dto.joined_on),
          created_by_user_id: userId,
        },
        select: TEAM_SELECT,
      });
      this.logger.log('Media team member created: id=' + row.id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      this.logger.error('DB error creating media team member', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/media-team-members/:id */
  async update(id: number, dto: UpdateTeamMemberDto, userId: number) {
    try {
      const row = await this.prisma.media_team_members.update({
        where: { id },
        data: {
          full_name: dto.full_name,
          designation: dto.designation,
          email: dto.email,
          phone: dto.phone,
          skills: dto.skills,
          photo_url: dto.photo_url,
          status: dto.status,
          joined_on: toDate(dto.joined_on),
        },
        select: TEAM_SELECT,
      });
      this.logger.log('Media team member updated: id=' + id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Team member not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error updating media team member #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /me/media-team-members/:id
   *
   * A member who still has shoots against their name is kept: removing them
   * would strip the crew record off delivered work. The caller is told to mark
   * them inactive instead, which is what the roster's status field is for.
   */
  async remove(id: number, userId: number) {
    const assigned = await this.prisma.media_shoot_assignments.count({
      where: { assigned_to_member_id: id },
    });
    if (assigned > 0) {
      throw new ConflictException({
        message:
          'This member is assigned to ' +
          assigned +
          ' shoot(s). Mark them inactive instead of deleting.',
        errorCode: 'TEAM_MEMBER_HAS_ASSIGNMENTS',
      });
    }

    try {
      await this.prisma.media_team_members.delete({ where: { id } });
      this.logger.log('Media team member deleted: id=' + id + ' by user=' + userId);
      return { message: 'Team member deleted successfully' };
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Team member not found',
          errorCode: 'NOT_FOUND',
        });
      }
      if (hasCode(err, 'P2003')) {
        throw new ConflictException({
          message: 'This member is still referenced and cannot be deleted',
          errorCode: 'TEAM_MEMBER_IN_USE',
        });
      }
      this.logger.error('DB error deleting media team member #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
