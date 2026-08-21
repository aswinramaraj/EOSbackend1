import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomOdService } from './media-room-od.service';
import { ApplyOdDto } from './dto/apply-od.dto';

@Controller('media-room/employee/od')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomOdController {
  constructor(private readonly service: MediaRoomOdService) {}

  /** GET /api/v1/media-room/employee/od/history?status= */
  @Get('history')
  findHistory(@Query('status') status: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.service.findHistory(user.sub, status);
  }

  /** POST /api/v1/media-room/employee/od */
  @Post()
  apply(@Body() dto: ApplyOdDto, @CurrentUser() user: JwtPayload) {
    return this.service.apply(dto, user.sub);
  }
}
