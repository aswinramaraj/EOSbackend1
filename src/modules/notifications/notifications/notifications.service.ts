import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Real, Prisma-backed create — this was previously unimplemented Nest CLI
   * scaffolding (`return 'This action adds a new notification'`). Only
   * `create()` is implemented for real; `findAll`/`findOne`/`update`/`remove`
   * below are left as the original stubs since nothing calls them yet and
   * building out a full notifications inbox is a separate piece of work.
   * This does not push over the websocket gateway (no real-time delivery
   * yet) — it persists a row a client can poll for via a future
   * `GET /notifications` endpoint.
   */
  create(dto: CreateNotificationDto) {
    return this.prisma.notifications.create({ data: dto });
  }

  findAll() {
    return `This action returns all notifications`;
  }

  /**
   * GET /me/notifications — self-scoped inbox for the bell icon. Additive:
   * the stub findAll()/findOne() above are left untouched since nothing
   * else calls them.
   */
  async findAllForUser(
    userId: number,
    options: { page: number; limit: number; unreadOnly: boolean },
  ) {
    const where = {
      user_id: userId,
      ...(options.unreadOnly && { is_read: false }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notifications.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (options.page - 1) * options.limit,
        take: options.limit,
      }),
      this.prisma.notifications.count({ where }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page: options.page,
        limit: options.limit,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  countUnread(userId: number) {
    return this.prisma.notifications.count({
      where: { user_id: userId, is_read: false },
    });
  }

  async markRead(id: number, userId: number) {
    const notification = await this.prisma.notifications.findFirst({
      where: { id, user_id: userId },
    });
    if (!notification) {
      throw new NotFoundException({
        message: 'Notification not found',
        errorCode: 'NOTIFICATION_NOT_FOUND',
      });
    }
    if (notification.is_read) return notification;
    return this.prisma.notifications.update({
      where: { id },
      data: { is_read: true },
    });
  }

  markAllRead(userId: number) {
    return this.prisma.notifications.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
  }

  findOne(id: number) {
    return `This action returns a #${id} notification`;
  }

  update(id: number, updateNotificationDto: UpdateNotificationDto) {
    return `This action updates a #${id} notification`;
  }

  remove(id: number) {
    return `This action removes a #${id} notification`;
  }
}
