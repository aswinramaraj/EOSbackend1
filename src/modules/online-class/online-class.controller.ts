import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { OnlineClassService } from './online-class.service';
import { StartOnlineClassDto } from './dto/start-online-class.dto';
import { ScheduleOnlineClassDto } from './dto/schedule-online-class.dto';

/**
 * Real-time video classroom (LiveKit) - see online-class.service.ts for the
 * token-generation and attendance logic. LIVEKIT_API_SECRET never leaves
 * the service layer; only a short-lived per-participant token crosses the
 * wire.
 */
@Controller('online-classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT, ROLES.FACULTY, ROLES.HOD)
export class OnlineClassController {
  constructor(private readonly onlineClassService: OnlineClassService) {}

  /** POST /api/v1/online-classes/start (Faculty/HoD) */
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  start(@Body() dto: StartOnlineClassDto, @CurrentUser() user: JwtPayload) {
    return this.onlineClassService.startClass(user.sub, dto);
  }

  /** POST /api/v1/online-classes/schedule (Faculty/HoD) */
  @Post('schedule')
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  schedule(@Body() dto: ScheduleOnlineClassDto, @CurrentUser() user: JwtPayload) {
    return this.onlineClassService.scheduleClass(user.sub, dto);
  }

  /** GET /api/v1/online-classes/scheduled (Faculty/HoD) - the caller's own upcoming scheduled sessions. */
  @Get('scheduled')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  findScheduled(@CurrentUser() user: JwtPayload) {
    return this.onlineClassService.listMyScheduled(user.sub);
  }

  /** GET /api/v1/online-classes/today */
  @Get('today')
  findToday(@CurrentUser() user: JwtPayload) {
    return this.onlineClassService.listToday(user.sub, user.role);
  }

  /** POST /api/v1/online-classes/:id/join */
  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  join(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.onlineClassService.joinClass(user.sub, user.role, id);
  }

  /** POST /api/v1/online-classes/:id/leave */
  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  leave(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.onlineClassService.leaveClass(user.sub, id);
  }

  /** POST /api/v1/online-classes/:id/end (Faculty/HoD, own class only) */
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  end(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.onlineClassService.endClass(user.sub, id);
  }
}
