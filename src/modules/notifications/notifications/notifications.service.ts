import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { PushNotificationService } from './push-notification.service';

/**
 * The app-wide in-app notification inbox (the bell icon on the Home tab) -
 * every event type (approvals, LMS, announcements, fees, wallet,
 * attendance, library, placements, hostel, ...) funnels through here via
 * notify(), which both persists the durable in-app row AND best-effort
 * pushes to the recipient's registered device(s) (see
 * PushNotificationService). Read state, list, and unread count are the
 * whole surface a client actually needs for a bell icon - there's no
 * update()/remove() beyond marking read, since nothing in this app lets a
 * user edit or delete a notification.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
  ) {}

  /**
   * Pure DB write, no push - kept separate from notify() below for the one
   * pre-existing caller (BorrowRecordsService's overdue-reminder sender)
   * that historically only wanted the in-app row. New producers should
   * call notify() instead, which does both.
   */
  create(dto: CreateNotificationDto) {
    return this.prisma.notifications.create({ data: dto });
  }

  /**
   * The method every real notification producer (leave/OD approvals, LMS
   * tasks, announcements, ...) should call - persists the in-app row, then
   * best-effort pushes to the recipient's device(s). Push failures are
   * swallowed inside PushNotificationService and never propagate here - a
   * push going undelivered must never make the notification itself (or
   * whatever real action triggered it) fail.
   */
  async notify(dto: CreateNotificationDto) {
    const notification = await this.create(dto);
    await this.push.sendToUser(dto.user_id, dto.title, dto.message, {
      type: dto.type,
      related_entity_type: dto.related_entity_type,
      related_entity_id: dto.related_entity_id,
    });
    return notification;
  }

  /**
   * GET /me/notifications — self-scoped, paginated/filterable inbox for the
   * bell icon. Distinct from findAllForUser() below (the simpler,
   * unfiltered list backing GET /notifications) — same table, two
   * independently-designed endpoints.
   */
  async findPaginatedForUser(
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

  /**
   * GET /me/notifications/panel — the bell dropdown's contents: everything
   * unread, plus anything pinned (a pinned notification stays visible even
   * after it's been read, and is only removed by the user manually
   * unpinning-then-reading it or clicking it directly). Pinned rows sort
   * first so they don't get buried once new unread ones arrive.
   */
  findPanelForUser(userId: number) {
    return this.prisma.notifications.findMany({
      where: {
        user_id: userId,
        OR: [{ is_read: false }, { is_pinned: true }],
      },
      orderBy: [{ is_pinned: 'desc' }, { created_at: 'desc' }],
      take: 50,
    });
  }

  async pin(id: number, userId: number) {
    const notification = await this.prisma.notifications.findFirst({
      where: { id, user_id: userId },
    });
    if (!notification) {
      throw new NotFoundException({
        message: 'Notification not found',
        errorCode: 'NOTIFICATION_NOT_FOUND',
      });
    }
    return this.prisma.notifications.update({
      where: { id },
      data: { is_pinned: true },
    });
  }

  async unpin(id: number, userId: number) {
    const notification = await this.prisma.notifications.findFirst({
      where: { id, user_id: userId },
    });
    if (!notification) {
      throw new NotFoundException({
        message: 'Notification not found',
        errorCode: 'NOTIFICATION_NOT_FOUND',
      });
    }
    return this.prisma.notifications.update({
      where: { id },
      data: { is_pinned: false },
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

  /** GET /notifications (self-scoped - every role has one inbox, their own). */
  findAllForUser(userId: number) {
    return this.prisma.notifications.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
  }

  /** GET /notifications/unread-count */
  async getUnreadCount(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.notifications.count({
      where: { user_id: userId, is_read: false },
    });
    return { count };
  }

  /**
   * PATCH /notifications/:id/read
   *
   * Error cases:
   *  404 NOTIFICATION_NOT_FOUND - doesn't exist
   *  403 NOT_OWNER              - exists, but belongs to someone else (never leaked as 404 - see below)
   */
  async markAsRead(id: number, userId: number) {
    const notification = await this.prisma.notifications.findUnique({ where: { id } });
    if (!notification) {
      throw new NotFoundException({
        message: 'Notification not found',
        errorCode: 'NOTIFICATION_NOT_FOUND',
      });
    }
    // Existence isn't sensitive here the way it is for, say, a draft
    // announcement - a plain 403 (rather than a existence-hiding 404) is
    // fine since a notification id reveals nothing about its content.
    if (notification.user_id !== userId) {
      throw new ForbiddenException({
        message: 'This notification does not belong to you',
        errorCode: 'NOT_OWNER',
      });
    }

    return this.prisma.notifications.update({
      where: { id },
      data: { is_read: true },
    });
  }

  /** POST /notifications/read-all */
  async markAllAsRead(userId: number): Promise<{ updated: number }> {
    const result = await this.prisma.notifications.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
    return { updated: result.count };
  }
}
