import { Controller, Get, Param, Patch, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse } from 'src/common/dto/api-response.dto';
import { NotificationsService } from './notifications.service';
import { ListMyNotificationsQueryDto } from './dto/list-my-notifications-query.dto';

/**
 * Self-scoped notifications inbox (bell icon). Any authenticated role can
 * have notifications — not restricted with @Roles. Distinct from the
 * broader NotificationsController (mounted at /notifications): this is the
 * self-service surface for an inbox list, unread count, and mark-as-read.
 */
@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class MeNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findMine(
    @Query() query: ListMyNotificationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.findPaginatedForUser(user.sub, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      unreadOnly: query.unread === 'true',
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.notificationsService.countUnread(user.sub);
    return ApiResponse.ok({ count });
  }

  /** GET /me/notifications/panel — the bell dropdown's contents (unread + pinned). */
  @Get('panel')
  async panel(@CurrentUser() user: JwtPayload) {
    const rows = await this.notificationsService.findPanelForUser(user.sub);
    return ApiResponse.ok(rows);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markRead(id, user.sub);
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: JwtPayload) {
    const result = await this.notificationsService.markAllRead(user.sub);
    return ApiResponse.ok({ updated: result.count });
  }

  @Patch(':id/pin')
  pin(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.pin(id, user.sub);
  }

  @Patch(':id/unpin')
  unpin(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.unpin(id, user.sub);
  }
}
