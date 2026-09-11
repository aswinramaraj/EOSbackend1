import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { FindNotificationsQueryDto } from './dto/find-notifications-query.dto';

/**
 * Deliberately separate from the existing WebSocket-only
 * notifications.gateway.ts/.service.ts — this is a new, isolated REST
 * surface over the same `notifications` table, scoped strictly to the
 * calling user (never another user's rows), for a plain fetch-based inbox
 * page. Not wired to the gateway's real-time delivery in any way.
 */
@Injectable()
export class NotificationsRestService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForUser(userId: number, query: FindNotificationsQueryDto) {
    const where: { user_id: number; is_read?: boolean } = { user_id: userId };
    if (query.is_read !== undefined) where.is_read = query.is_read === 'true';

    const [data, total] = await this.prisma.$transaction([
      this.prisma.notifications.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.notifications.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async markRead(id: number, userId: number) {
    const existing = await this.prisma.notifications.findUnique({
      where: { id },
    });
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundException({
        message: 'Notification not found',
        errorCode: 'NOTIFICATION_NOT_FOUND',
      });
    }

    return this.prisma.notifications.update({
      where: { id },
      data: { is_read: true },
    });
  }

  async markAllRead(userId: number) {
    const result = await this.prisma.notifications.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
    return { updated: result.count };
  }
}
