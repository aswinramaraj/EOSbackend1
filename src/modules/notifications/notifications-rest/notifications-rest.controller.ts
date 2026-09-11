import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsRestService } from './notifications-rest.service';
import { FindNotificationsQueryDto } from './dto/find-notifications-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse } from 'src/common/dto/api-response.dto';

/**
 * Any authenticated role — this is per-user inbox data, not a coe-scoped
 * resource, so only JwtAuthGuard applies (no RolesGuard/@Roles). Every
 * query is scoped to the caller's own user id.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsRestController {
  constructor(
    private readonly notificationsRestService: NotificationsRestService,
  ) {}

  @Get()
  findAll(
    @Query() query: FindNotificationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsRestService.findAllForUser(user.sub, query);
  }

  @Patch('mark-all-read')
  async markAllRead(@CurrentUser() user: JwtPayload) {
    const result = await this.notificationsRestService.markAllRead(user.sub);
    return ApiResponse.ok(result, 'Notifications marked as read');
  }

  @Patch(':id/read')
  async markRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const notification = await this.notificationsRestService.markRead(
      id,
      user.sub,
    );
    return ApiResponse.ok(notification, 'Notification marked as read');
  }
}
