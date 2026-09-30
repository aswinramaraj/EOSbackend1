import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceService } from './attendance.service';

/**
 * GET /api/v1/me/attendance-reviews — Class Advisor's or HoD's own pending
 * review queue (see AttendanceService.listPendingReviews). Faculty is
 * included in the guard because a Class Advisor is a Faculty member with no
 * separate "advisor" role — a Faculty caller who mentors no class simply
 * gets an empty list, same convention as GET /me/student-ods.
 */
@Controller('me/attendance-reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY, ROLES.HOD)
export class MeAttendanceReviewsController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.attendanceService.listPendingReviews(user);
  }
}
