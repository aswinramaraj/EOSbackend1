import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceService } from './attendance.service';
import { MarkClassAttendanceDto } from './dto/mark-class-attendance.dto';

/**
 * POST /api/v1/me/classes/:class_id/attendance — Faculty only.
 *
 * A separate controller (not AttendanceController) because the required
 * path is /me/classes/:class_id/attendance, not /attendance — Nest always
 * prepends a controller's own @Controller() prefix to every route. Shares
 * the 'me/classes' prefix with MeClassesController (Timetable module, for
 * GET /me/classes/today) but lives in this module since it delegates to
 * AttendanceService; the two controllers' routes don't overlap.
 */
@Controller('me/classes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeClassesAttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post(':class_id/attendance')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  markAttendance(
    @Param('class_id', ParseIntPipe) classId: number,
    @Body() dto: MarkClassAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.markForClass(classId, dto, user.sub);
  }

  /** GET /api/v1/me/classes/:class_id/roster — Faculty / Secretary. */
  @Get(':class_id/roster')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY)
  getRoster(@Param('class_id', ParseIntPipe) classId: number) {
    return this.attendanceService.getClassRoster(classId);
  }
}
