import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectMediaRoomSchema } from './media-room-schema.util';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

export interface TeamMemberRow {
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

/** Media team roster — media_team_members (new table, not in schema.prisma). */
@Injectable()
export class MediaRoomTeamService {
  private readonly logger = new Logger(MediaRoomTeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.team) return { ready: false, data: [] };

    try {
      const rows = await this.prisma.$queryRaw<TeamMemberRow[]>(Prisma.sql`
        SELECT id, full_name, designation, email, phone, skills, photo_url, status, joined_on, created_at
        FROM media_team_members ORDER BY full_name ASC
      `);
      return { ready: true, data: rows };
    } catch (err) {
      this.logger.error('DB error listing media team members', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async findOne(id: number) {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.team) throw new NotFoundException({ message: 'Media team member not found', errorCode: 'TEAM_MEMBER_NOT_FOUND' });

    try {
      const rows = await this.prisma.$queryRaw<TeamMemberRow[]>(Prisma.sql`
        SELECT id, full_name, designation, email, phone, skills, photo_url, status, joined_on, created_at
        FROM media_team_members WHERE id = ${id}
      `);
      if (rows.length === 0) throw new NotFoundException({ message: 'Media team member not found', errorCode: 'TEAM_MEMBER_NOT_FOUND' });
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error fetching media team member ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async create(dto: CreateTeamMemberDto, userId: number) {
    try {
      const rows = await this.prisma.$queryRaw<TeamMemberRow[]>(Prisma.sql`
        INSERT INTO media_team_members (full_name, designation, email, phone, skills, photo_url, joined_on, created_by_user_id)
        VALUES (${dto.full_name}, ${dto.designation ?? null}, ${dto.email ?? null}, ${dto.phone ?? null}, ${dto.skills ?? null}, ${dto.photo_url ?? null}, ${dto.joined_on ?? null}, ${userId})
        RETURNING id, full_name, designation, email, phone, skills, photo_url, status, joined_on, created_at
      `);
      return rows[0];
    } catch (err) {
      this.logger.error('DB error creating media team member', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async update(id: number, dto: UpdateTeamMemberDto) {
    await this.findOne(id);
    try {
      const rows = await this.prisma.$queryRaw<TeamMemberRow[]>(Prisma.sql`
        UPDATE media_team_members SET
          full_name = COALESCE(${dto.full_name ?? null}, full_name),
          designation = COALESCE(${dto.designation ?? null}, designation),
          email = COALESCE(${dto.email ?? null}, email),
          phone = COALESCE(${dto.phone ?? null}, phone),
          skills = COALESCE(${dto.skills ?? null}, skills),
          photo_url = COALESCE(${dto.photo_url ?? null}, photo_url),
          status = COALESCE(${dto.status ?? null}, status)
        WHERE id = ${id}
        RETURNING id, full_name, designation, email, phone, skills, photo_url, status, joined_on, created_at
      `);
      return rows[0];
    } catch (err) {
      this.logger.error(`DB error updating media team member ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    await this.findOne(id);
    try {
      await this.prisma.$executeRaw(Prisma.sql`DELETE FROM media_team_members WHERE id = ${id}`);
      return { id };
    } catch (err) {
      this.logger.error(`DB error deleting media team member ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
