import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { GetAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-attendance.dto';
import { GetExamResultsDto } from 'src/modules/admissions/students/me-profile/dto/get-exam-results.dto';
import { GetMyTimetableQueryDto } from 'src/modules/faculty/timetable/dto/get-my-timetable-query.dto';
import { ParentsService } from './parents.service';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PARENT)
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  /** GET /api/v1/me/children — Parent only. */
  @Get('children')
  listChildren(@CurrentUser() user: JwtPayload) {
    return this.parentsService.listChildren(user.sub);
  }

  /** GET /api/v1/me/children/:studentId/attendance?from=&to=&subject_id= — Parent only, own child. */
  @Get('children/:studentId/attendance')
  getChildAttendance(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildAttendance(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/performance?semester= — Parent only, own child. */
  @Get('children/:studentId/performance')
  getChildPerformance(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetExamResultsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildPerformance(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/fees — Parent only, own child. */
  @Get('children/:studentId/fees')
  getChildFees(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildFees(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/timetable?day= — Parent only, own child. */
  @Get('children/:studentId/timetable')
  getChildTimetable(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetMyTimetableQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildTimetable(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/academic-calendar — Parent only, own child. */
  @Get('children/:studentId/academic-calendar')
  getChildAcademicCalendar(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildAcademicCalendar(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/upcoming-drives — Parent only, own child. */
  @Get('children/:studentId/upcoming-drives')
  getChildUpcomingDrives(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildUpcomingDrives(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/placement-history — Parent only, own child. */
  @Get('children/:studentId/placement-history')
  getChildPlacementHistory(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildPlacementHistory(user.sub, studentId);
  }
}
