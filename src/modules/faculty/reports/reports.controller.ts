import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { FacultyReportsService } from './reports.service';

/**
 * Faculty-side Reports & Analytics data that doesn't already live in an
 * existing module — currently just the weekly attendance trend. Lives in
 * its own module since no existing faculty module owns "reports" as a
 * concern (the Reports page otherwise composes GET /me/handled-classes and
 * GET /me/subject-records directly).
 */
@Controller('me/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY, ROLES.HOD)
export class FacultyReportsController {
  constructor(private readonly reportsService: FacultyReportsService) {}

  /** GET /api/v1/me/reports/weekly-attendance */
  @Get('weekly-attendance')
  getWeeklyAttendanceTrend(@CurrentUser() user: JwtPayload) {
    return this.reportsService.getWeeklyAttendanceTrend(user.sub);
  }
}
