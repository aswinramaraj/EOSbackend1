import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FacultyAttendanceService } from './faculty-attendance.service';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { QueryAttendanceOverviewDto } from './dto/query-attendance-overview.dto';

/**
 * Admin/HoD read-only view of a faculty's day-by-day presence — no edit
 * endpoint by design (see FACULTY_MODULE_UPDATE.md). Populating
 * faculty_daily_attendance is a separate concern (e.g. a biometric/punch
 * import) not built here; this module only reads and aggregates it.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me/faculty')
export class FacultyAttendanceController {
  constructor(private readonly attendanceService: FacultyAttendanceService) {}

  @Get('attendance/overview')
  @Roles(ROLES.ADMIN, ROLES.HOD)
  getOverview(@Query() query: QueryAttendanceOverviewDto) {
    return this.attendanceService.getOverview(
      query.department_id,
      query.academic_year,
      query.search,
    );
  }

  @Get(':id/attendance')
  @Roles(ROLES.ADMIN, ROLES.HOD)
  getForFaculty(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryAttendanceDto,
  ) {
    return this.attendanceService.getForFaculty(id, query.academic_year);
  }
}
