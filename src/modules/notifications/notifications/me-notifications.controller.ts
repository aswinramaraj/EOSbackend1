import { Controller, Get, Param, Patch, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse } from 'src/common/dto/api-response.dto';
import { NotificationsService } from './notifications.service';
import { ListMyNotificationsQueryDto } from './dto/list-my-notifications-query.dto';

/**
 * Self-scoped notifications inbox (bell icon). Any authenticated role can
 * have notifications — not restricted with @Roles. New controller alongside
 * the existing NotificationsGateway (websocket, real-time push); this is
 * the polling/REST counterpart the frontend needs for an inbox list, unread
 * count, and mark-as-read, none of which existed before.
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
    return this.notificationsService.findAllForUser(user.sub, {
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
}
