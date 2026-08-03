import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate, PaginationDto } from 'src/common/dto/pagination.dto';
import { CreateAlumniAnnouncementDto } from './dto/create-alumni-announcement.dto';

/**
 * `alumni_announcements` has no batch column at all — it's one shared feed
 * for every graduated batch, unlike `alumni_group_messages` which is
 * per-batch. So there is no isolation to enforce here on the read side.
 */
@Injectable()
export class AlumniAnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/alumni/announcements — same feed for every alumnus, any batch. */
  async listAnnouncements(dto: PaginationDto) {
    const [data, total] = await Promise.all([
      this.prisma.alumni_announcements.findMany({
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.alumni_announcements.count(),
    ]);

    return paginate(data, total, dto);
  }

  /** POST /admin/alumni-announcements — posted_by_user_id resolved from the JWT. */
  async createAnnouncement(userId: number, dto: CreateAlumniAnnouncementDto) {
    return this.prisma.alumni_announcements.create({
      data: {
        posted_by_user_id: userId,
        title: dto.title,
        content: dto.content,
      },
    });
  }
}
