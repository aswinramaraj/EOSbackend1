import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomAttendanceService } from './media-room-attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';

@Controller('media-room/employee/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomAttendanceController {
  constructor(private readonly service: MediaRoomAttendanceService) {}

  /** GET /api/v1/media-room/employee/attendance */
  @Get()
  findMine(@CurrentUser() user: JwtPayload) {
    return this.service.findMine(user.sub);
  }

  /** POST /api/v1/media-room/employee/attendance/mark — self-declared, no biometric device behind this. */
  @Post('mark')
  mark(@Body() dto: MarkAttendanceDto, @CurrentUser() user: JwtPayload) {
    return this.service.mark(dto, user.sub);
  }
}
