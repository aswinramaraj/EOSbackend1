import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomLeaveService } from './media-room-leave.service';
import { ApplyLeaveDto } from './dto/apply-leave.dto';

@Controller('media-room/employee/leave')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomLeaveController {
  constructor(private readonly service: MediaRoomLeaveService) {}

  /** GET /api/v1/media-room/employee/leave/types */
  @Get('types')
  findTypes() {
    return this.service.findTypes();
  }

  /** GET /api/v1/media-room/employee/leave/balances */
  @Get('balances')
  findBalances(@CurrentUser() user: JwtPayload) {
    return this.service.findBalances(user.sub);
  }

  /** GET /api/v1/media-room/employee/leave/history?status= */
  @Get('history')
  findHistory(@Query('status') status: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.service.findHistory(user.sub, status);
  }

  /** POST /api/v1/media-room/employee/leave */
  @Post()
  apply(@Body() dto: ApplyLeaveDto, @CurrentUser() user: JwtPayload) {
    return this.service.apply(dto, user.sub);
  }
}
