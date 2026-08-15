import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/**
 * The Home tab's bell icon - every role gets exactly one inbox, their own
 * (no @Roles() anywhere here; every authenticated account has one).
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushNotificationService,
  ) {}

  /** GET /api/v1/notifications */
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.findAllForUser(user.sub);
  }

  /** GET /api/v1/notifications/unread-count */
  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getUnreadCount(user.sub);
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   *
   * Error responses:
   *  401 UNAUTHORIZED
   *  403 NOT_OWNER
   *  404 NOTIFICATION_NOT_FOUND
   */
  @Patch(':id/read')
  markAsRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAsRead(id, user.sub);
  }

  /** POST /api/v1/notifications/read-all */
  @Post('read-all')
  markAllAsRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllAsRead(user.sub);
  }

  /**
   * POST /api/v1/notifications/register-device
   * Called once after login (and again whenever Expo hands the app a new
   * token, which does happen occasionally) - upserts by push_token, so
   * calling this repeatedly with the same token is always safe.
   */
  @Post('register-device')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerDevice(@Body() dto: RegisterDeviceTokenDto, @CurrentUser() user: JwtPayload) {
    return this.pushService.registerToken(user.sub, dto);
  }

  /**
   * DELETE /api/v1/notifications/register-device/:pushToken
   * Called on logout - stop pushing to a device once its owner logs out.
   * pushToken is a path param (not the body) since DELETE bodies are
   * unreliable across HTTP clients/proxies.
   */
  @Delete('register-device/:pushToken')
  @HttpCode(HttpStatus.NO_CONTENT)
  unregisterDevice(@Param('pushToken') pushToken: string) {
    return this.pushService.unregisterToken(pushToken);
  }
}
