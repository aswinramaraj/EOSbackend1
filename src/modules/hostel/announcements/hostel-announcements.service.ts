import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateHostelAnnouncementDto } from './dto/create-hostel-announcement.dto';

const ANNOUNCEMENT_INCLUDE = {
  users: { select: { email: true, hostel_wardens: { select: { name: true }, take: 1 } } },
} satisfies Prisma.announcementsInclude;

type AnnouncementWithRelations = Prisma.announcementsGetPayload<{
  include: typeof ANNOUNCEMENT_INCLUDE;
}>;

function toAnnouncementResponse(a: AnnouncementWithRelations) {
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    category: a.category,
    target_audience: a.target_audience,
    by: a.users.hostel_wardens[0]?.name ?? a.users.email,
    created_at: a.created_at.toISOString(),
  };
}

/**
 * Hostel circulars — reuses the shared `announcements` table (same pattern
 * as the Medical Centre module's advisories panel) rather than a new table.
 * Scoped to posts made by ANY warden (a shared hostel notice board), not
 * just the caller's own — there's no hostel_id on announcements to narrow
 * it further, and residents/other wardens seeing all hostel circulars is
 * the intended behaviour here anyway.
 */
@Injectable()
export class HostelAnnouncementsService {
  private readonly logger = new Logger(HostelAnnouncementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    try {
      const rows = await this.prisma.announcements.findMany({
        where: { users: { roles: { name: 'warden' } } },
        include: ANNOUNCEMENT_INCLUDE,
        orderBy: { created_at: 'desc' },
        take: 50,
      });
      return rows.map(toAnnouncementResponse);
    } catch (err) {
      this.logger.error('DB error while listing hostel announcements', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async create(dto: CreateHostelAnnouncementDto, userId: number) {
    try {
      const created = await this.prisma.announcements.create({
        data: {
          posted_by_user_id: userId,
          title: dto.title,
          content: dto.content,
          category: dto.category,
          target_audience: 'students',
          status: 'published',
        },
        include: ANNOUNCEMENT_INCLUDE,
      });
      return toAnnouncementResponse(created);
    } catch (err) {
      this.logger.error('DB error while creating hostel announcement', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
