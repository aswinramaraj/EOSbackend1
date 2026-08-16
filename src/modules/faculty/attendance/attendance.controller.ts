import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import { MeStaffAttendanceService } from './me-staff-attendance.service';
import { GetStaffAttendanceDto } from './dto/get-staff-attendance.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly meStaffAttendanceService: MeStaffAttendanceService,
  ) {}

  /**
   * POST /api/v1/attendance — Faculty, Secretary. Secretary added for the
   * Secretary Portal's Bulk Attendance "Mark" tab — has no `faculty` table
   * row, handled by a distinct branch in the service (see
   * AttendanceService.create) that skips the faculty-profile lookup,
   * mirroring the same pattern already used for media-requests.
   */
  @Post('attendance')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAttendanceDto, @CurrentUser() user: JwtPayload) {
    return this.attendanceService.create(dto, user.sub, user.role);
  }

  /** GET /api/v1/attendance — Admin/HoD/Faculty/Student/Parent/Secretary. Student/Parent are scoped to their own records; Secretary is institution-wide (same posture as Admin/HoD here). */
  @Get('attendance')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.FACULTY, ROLES.STUDENT, ROLES.PARENT, ROLES.SECRETARY)
  findAll(
    @Query() query: ListAttendanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.findAll(query, user);
  }

  /** GET /api/v1/attendance/:id — Admin/HoD/Faculty/Student/Parent. Student/Parent are scoped to their own records. */
  @Get('attendance/:id')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.FACULTY, ROLES.STUDENT, ROLES.PARENT)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.findOne(id, user);
  }

  /** PATCH /api/v1/attendance/:id — Faculty only, and only the faculty who marked it. */
  @Patch('attendance/:id')
  @Roles(ROLES.FACULTY)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.update(id, dto, user.sub);
  }

  /**
   * GET /api/v1/me/staff-attendance?year=&month= — Faculty/HoD/HR Payroll.
   * Self-scoped, best-effort staff attendance derived from approved leaves
   * and holiday-slot opt-ins (see MeStaffAttendanceService for details).
   * HoD and HR Payroll staff also have their own faculty row (same table,
   * same faculty_daily_attendance source) - resolveFacultyByUserId() 404s
   * with FACULTY_NOT_FOUND for any of these three roles if that row doesn't
   * exist, so widening the roles here never fabricates data for an account
   * that has none.
   */
  @Get('staff-attendance')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  getStaffAttendance(
    @Query() query: GetStaffAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.meStaffAttendanceService.getMyStaffAttendance(
      user.sub,
      query,
    );
  }

  /**
   * GET /api/v1/me/staff-attendance-review?year=&month= — HoD/HR Payroll
   * only. One row per active faculty member with that month's stats - backs
   * the HR attendance roster list.
   */
  @Get('staff-attendance-review')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  listStaffAttendanceForReview(@Query() query: GetStaffAttendanceDto) {
    return this.meStaffAttendanceService.listStaffAttendanceForReview(query);
  }

  /**
   * GET /api/v1/me/staff-attendance/:facultyId?year=&month= — HoD/HR
   * Payroll only. Same shape as GET /me/staff-attendance but for a faculty
   * member chosen by id - backs the drill-down calendar from the roster.
   */
  @Get('staff-attendance/:facultyId')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  getStaffAttendanceForFaculty(
    @Param('facultyId', ParseIntPipe) facultyId: number,
    @Query() query: GetStaffAttendanceDto,
  ) {
    return this.meStaffAttendanceService.getStaffAttendanceForFacultyId(
      facultyId,
      query,
    );
  }
}
