import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Talks to Expo's push notification service - not raw Firebase Cloud
 * Messaging/APNs directly. Expo's push service is what actually calls
 * FCM/APNs under the hood (using the credentials tied to this app's EAS
 * project + google-services.json), but this backend only ever needs to
 * know Expo's own HTTP API, never FCM/APNs specifics.
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /notifications/register-device (any authenticated role).
   * Upserts by push_token - a token always belongs to exactly one device,
   * so re-registering (app reopened) just refreshes user_id/updated_at,
   * and a token that shows up under a different account (shared device,
   * different login) reassigns to whoever is logged in now rather than
   * erroring - there is no meaningful "wrong owner" case for a device
   * token the way there is for, say, an achievement post.
   */
  async registerToken(userId: number, dto: RegisterDeviceTokenDto) {
    await this.prisma.device_push_tokens.upsert({
      where: { push_token: dto.push_token },
      create: { user_id: userId, push_token: dto.push_token, platform: dto.platform },
      update: { user_id: userId, platform: dto.platform, updated_at: new Date() },
    });
  }

  /** DELETE /notifications/register-device (logout) - stop pushing to a device once its owner logs out. */
  async unregisterToken(pushToken: string) {
    await this.prisma.device_push_tokens.deleteMany({ where: { push_token: pushToken } });
  }

  /**
   * Best-effort, never throws - a push delivery failure must never break
   * whatever real action triggered it (a leave getting approved must
   * succeed even if the approver's phone can't be reached right now). The
   * in-app notifications row (NotificationsService.notify) is the durable
   * record; this is just an best-effort extra nudge on top of it.
   */
  async sendToUser(
    userId: number,
    title: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    let tokens: { push_token: string }[];
    try {
      tokens = await this.prisma.device_push_tokens.findMany({
        where: { user_id: userId },
        select: { push_token: true },
      });
    } catch (err) {
      this.logger.error(`Failed to look up push tokens for user ${userId}`, err);
      return;
    }
    if (tokens.length === 0) return;

    const tokenValues = tokens.map((t) => t.push_token);

    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          tokenValues.map((to) => ({ to, title, body: message, data, sound: 'default' })),
        ),
      });

      const payload = (await response.json().catch(() => null)) as { data?: ExpoPushTicket[] } | null;
      await this.pruneDeadTokens(tokenValues, payload?.data);
    } catch (err) {
      this.logger.error(`Push send failed for user ${userId}`, err);
    }
  }

  /**
   * Expo's response array is positionally aligned with the request array
   * (same order, same length) - a ticket reporting DeviceNotRegistered
   * means that exact token is permanently dead (app uninstalled, etc.) and
   * should stop being pushed to, so it's removed here rather than retried
   * forever on every future notification.
   */
  private async pruneDeadTokens(sentTokens: string[], tickets: ExpoPushTicket[] | undefined) {
    if (!tickets || tickets.length !== sentTokens.length) return;

    const deadTokens = tickets
      .map((ticket, index) => (ticket.details?.error === 'DeviceNotRegistered' ? sentTokens[index] : null))
      .filter((token): token is string => token !== null);

    if (deadTokens.length === 0) return;

    try {
      await this.prisma.device_push_tokens.deleteMany({ where: { push_token: { in: deadTokens } } });
    } catch (err) {
      this.logger.error('Failed to prune dead push tokens', err);
    }
  }
}
