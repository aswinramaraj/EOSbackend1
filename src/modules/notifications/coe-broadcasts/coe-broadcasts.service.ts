import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { coe_broadcast_audience_enum } from 'generated/prisma/client';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { FindBroadcastsQueryDto } from './dto/find-broadcasts-query.dto';

/**
 * "Portal" delivery is real — publishing fans out into the same
 * `notifications` table the whole app's in-app inbox already reads from.
 * send_email/send_sms are stored as what the COE asked for and disclosed as
 * such on the frontend; no email/SMS-sending integration exists anywhere
 * in this backend, so neither is ever actually dispatched here.
 */
@Injectable()
export class CoeBroadcastsService {
  private readonly logger = new Logger(CoeBroadcastsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveRecipientUserIds(
    audience: coe_broadcast_audience_enum,
  ): Promise<number[]> {
    if (audience === 'faculty') {
      const rows = await this.prisma.users.findMany({
        where: { roles: { name: 'faculty' } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    if (audience === 'hods') {
      const rows = await this.prisma.users.findMany({
        where: { roles: { name: 'hod' } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    if (audience === 'all_students') {
      const rows = await this.prisma.students.findMany({
        where: { status: 'active' },
        select: { user_id: true },
      });
      return rows.map((r) => r.user_id);
    }
    if (audience === 'final_year_students') {
      const classes = await this.prisma.classes.findMany({
        select: {
          id: true,
          current_semester: true,
          courses: { select: { duration_years: true } },
        },
      });
      const finalYearClassIds = classes
        .filter(
          (c) =>
            c.current_semester != null &&
            c.current_semester > (c.courses.duration_years - 1) * 2,
        )
        .map((c) => c.id);
      if (finalYearClassIds.length === 0) return [];
      const rows = await this.prisma.students.findMany({
        where: { status: 'active', class_id: { in: finalYearClassIds } },
        select: { user_id: true },
      });
      return rows.map((r) => r.user_id);
    }
    return [];
  }

  private async dispatch(broadcastId: number) {
    const broadcast = await this.prisma.coe_notification_broadcasts.findUnique({
      where: { id: broadcastId },
    });
    if (!broadcast) return;

    const userIds = await this.resolveRecipientUserIds(broadcast.audience);

    await this.prisma.$transaction(async (tx) => {
      if (broadcast.send_portal && userIds.length > 0) {
        await tx.notifications.createMany({
          data: userIds.map((userId) => ({
            user_id: userId,
            title: broadcast.title,
            message: broadcast.message,
            type: broadcast.category,
            related_entity_type: 'coe_notification_broadcast',
            related_entity_id: broadcast.id,
          })),
        });
      }
      await tx.coe_notification_broadcasts.update({
        where: { id: broadcastId },
        data: {
          status: 'published',
          published_at: new Date(),
          recipient_count: userIds.length,
        },
      });
    });
  }

  async create(dto: CreateBroadcastDto, userId: number) {
    const broadcast = await this.prisma.coe_notification_broadcasts.create({
      data: {
        posted_by_user_id: userId,
        title: dto.title,
        category: dto.category,
        audience: dto.audience,
        send_portal: dto.send_portal ?? true,
        send_email: dto.send_email ?? false,
        send_sms: dto.send_sms ?? false,
        message: dto.message,
        status: dto.scheduled_at ? 'scheduled' : 'draft',
        scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
      },
    });

    if (!dto.scheduled_at) {
      await this.dispatch(broadcast.id);
      return this.prisma.coe_notification_broadcasts.findUnique({
        where: { id: broadcast.id },
      });
    }

    return broadcast;
  }

  async findAll(query: FindBroadcastsQueryDto) {
    return this.prisma.coe_notification_broadcasts.findMany({
      where: { category: query.category, status: query.status },
      orderBy: { created_at: 'desc' },
    });
  }

  /** A "scheduled" broadcast is genuinely dispatched once scheduled_at arrives, not just marked so. */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDueBroadcasts() {
    const due = await this.prisma.coe_notification_broadcasts.findMany({
      where: { status: 'scheduled', scheduled_at: { lte: new Date() } },
      select: { id: true },
    });
    for (const b of due) {
      try {
        await this.dispatch(b.id);
      } catch (err) {
        this.logger.error(
          `Failed to dispatch scheduled broadcast ${b.id}`,
          err,
        );
      }
    }
  }
}
