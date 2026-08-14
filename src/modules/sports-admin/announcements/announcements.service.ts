import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { INTERNAL_ERROR } from 'src/modules/sports-admin/common/sports-common';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { SearchAnnouncementsDto } from './dto/search-announcements.dto';

const ANNOUNCEMENT_INCLUDE = {
  users: { select: { id: true, email: true } },
} satisfies Prisma.sports_announcementsInclude;

type AnnouncementWithRelations = Prisma.sports_announcementsGetPayload<{
  include: typeof ANNOUNCEMENT_INCLUDE;
}>;

function toAnnouncementResponse(announcement: AnnouncementWithRelations) {
  const content = announcement.content;
  return {
    id: announcement.id,
    title: announcement.title,
    sub: content.slice(0, 120) + (content.length > 120 ? '…' : ''),
    category: announcement.category,
    posted_at: announcement.created_at.toISOString(),
    posted_by: { id: announcement.users.id, email: announcement.users.email },
  };
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/announcements?category=&q= */
  async findAll(dto: SearchAnnouncementsDto) {
    const where: Prisma.sports_announcementsWhereInput = {};
    if (dto.category) where.category = dto.category;
    if (dto.q) {
      where.OR = [
        { title: { contains: dto.q, mode: 'insensitive' } },
        { content: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    try {
      const announcements = await this.prisma.sports_announcements.findMany({
        where,
        include: ANNOUNCEMENT_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      return announcements.map(toAnnouncementResponse);
    } catch (err) {
      this.logger.error('DB error while fetching announcements', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** POST /sports-admin/announcements */
  async create(dto: CreateAnnouncementDto, userId: number) {
    try {
      const announcement = await this.prisma.sports_announcements.create({
        data: {
          title: dto.title,
          content: dto.content,
          category: dto.category,
          posted_by_user_id: userId,
        },
        include: ANNOUNCEMENT_INCLUDE,
      });
      return toAnnouncementResponse(announcement);
    } catch (err) {
      this.logger.error('DB error while creating announcement', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/announcements/:id
   *
   * Error cases:
   *  404 ANNOUNCEMENT_NOT_FOUND – no announcement with the given id
   */
  async findOne(id: number) {
    const announcement = await this.findById(id);
    if (!announcement) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }
    return toAnnouncementResponse(announcement);
  }

  /**
   * PATCH /sports-admin/announcements/:id
   *
   * Error cases:
   *  404 ANNOUNCEMENT_NOT_FOUND – no announcement with the given id
   */
  async update(id: number, dto: UpdateAnnouncementDto) {
    const announcement = await this.findById(id);
    if (!announcement) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_announcements.update({
        where: { id },
        data: {
          title: dto.title,
          content: dto.content,
          category: dto.category,
        },
        include: ANNOUNCEMENT_INCLUDE,
      });
      return toAnnouncementResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating announcement', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/announcements/:id
   *
   * Error cases:
   *  404 ANNOUNCEMENT_NOT_FOUND – no announcement with the given id
   */
  async remove(id: number) {
    const announcement = await this.findById(id);
    if (!announcement) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_announcements.delete({ where: { id } });
      return { message: 'Announcement deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting announcement', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_announcements.findUnique({
        where: { id },
        include: ANNOUNCEMENT_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during announcement lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
