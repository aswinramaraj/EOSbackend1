import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyAttendanceService } from './faculty-attendance.service';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { QueryAttendanceOverviewDto } from './dto/query-attendance-overview.dto';
import { MarkFacultyAttendanceDto } from './dto/mark-attendance.dto';

/**
 * Admin/HoD read-only view of a faculty's day-by-day presence, plus a manual
 * mark/correct endpoint (see markAttendance) — there's still no biometric/
 * punch import, so that's the only way faculty_daily_attendance gets
 * populated today.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me/faculty')
export class FacultyAttendanceController {
  constructor(private readonly attendanceService: FacultyAttendanceService) {}

  @Get('attendance/overview')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL)
  getOverview(@Query() query: QueryAttendanceOverviewDto) {
    return this.attendanceService.getOverview(
      query.department_id,
      query.academic_year,
      query.search,
    );
  }

  @Get(':id/attendance')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL)
  getForFaculty(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryAttendanceDto,
  ) {
    return this.attendanceService.getForFaculty(id, query.academic_year);
  }

  @Patch(':id/attendance/:date')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  markAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Param('date') date: string,
    @Body() dto: MarkFacultyAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.markAttendance(id, date, dto, user.sub);
  }
}
