import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceService } from './attendance.service';
import { MarkClassAttendanceDto } from './dto/mark-class-attendance.dto';

class AttendanceDraftQueryDto {
  @Type(() => Number)
  @IsInt()
  subject_id: number;

  @IsDateString()
  date: string;

  /** See MarkClassAttendanceDto's own doc comment (attendance_periods.query.md). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  period_number?: number;
}

class PublishClassAttendanceDto {
  @IsInt()
  subject_id: number;

  @IsDateString()
  attendance_date: string;
}

class ReviewClassAttendanceDto {
  @IsInt()
  subject_id: number;

  @IsDateString()
  attendance_date: string;

  @IsIn(['approve', 'send_back'])
  decision: 'approve' | 'send_back';
}

/**
 * POST /api/v1/me/classes/:class_id/attendance — Faculty/HoD.
 *
 * HOD included alongside FACULTY — every method resolves the caller via
 * their own faculty.user_id (see AttendanceService.resolveFacultyByUserId)
 * regardless of JWT role, and a HOD who also personally teaches a class
 * (faculty_subject_class_mapping) needs the exact same draft/publish
 * workflow as any other faculty member for that class — same precedent as
 * GET /me/classes/today (MeClassesController) and the attendance-recognize
 * roster endpoint (AttendanceCvController).
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
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  markAttendance(
    @Param('class_id', ParseIntPipe) classId: number,
    @Body() dto: MarkClassAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.markForClass(classId, dto, user.sub);
  }

  /** GET /api/v1/me/classes/:class_id/roster — Faculty / HoD / Secretary. */
  @Get(':class_id/roster')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  getRoster(@Param('class_id', ParseIntPipe) classId: number) {
    return this.attendanceService.getClassRoster(classId);
  }

  /**
   * GET /api/v1/me/classes/:class_id/attendance/draft?subject_id=&date=
   * Re-hydrates a previously-saved (unpublished or published) attendance
   * batch so the marking screen can be reopened before Publish.
   */
  @Get(':class_id/attendance/draft')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getDraft(
    @Param('class_id', ParseIntPipe) classId: number,
    @Query() query: AttendanceDraftQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.getDraftForClass(
      classId,
      query.subject_id,
      query.date,
      user.sub,
      query.period_number,
    );
  }

  /**
   * POST /api/v1/me/classes/:class_id/attendance/publish — the moment a
   * saved draft becomes visible to students/parents/advisors, mirroring
   * POST /me/subject-records/:id/publish.
   */
  @Post(':class_id/attendance/publish')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('class_id', ParseIntPipe) classId: number,
    @Body() dto: PublishClassAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.publishForClass(
      classId,
      dto.subject_id,
      dto.attendance_date,
      user.sub,
    );
  }

  /**
   * POST /api/v1/me/classes/:class_id/attendance/submit-for-review —
   * Faculty only. The optional alternative to Publish above: hands the
   * saved draft to the Class Advisor/HoD for sign-off instead of making it
   * visible immediately.
   */
  @Post(':class_id/attendance/submit-for-review')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.OK)
  submitForReview(
    @Param('class_id', ParseIntPipe) classId: number,
    @Body() dto: PublishClassAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.submitForReview(
      classId,
      dto.subject_id,
      dto.attendance_date,
      user.sub,
    );
  }

  /**
   * POST /api/v1/me/classes/:class_id/attendance/review — the class's
   * Class Advisor (class_mentors) or the HoD of its department only.
   * Faculty is included in the guard because a Class Advisor is a Faculty
   * member (no separate "advisor" role) — AttendanceService.
   * assertCanReviewClass enforces the actual mentor-or-HoD check.
   */
  @Post(':class_id/attendance/review')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.OK)
  review(
    @Param('class_id', ParseIntPipe) classId: number,
    @Body() dto: ReviewClassAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.reviewForClass(
      classId,
      dto.subject_id,
      dto.attendance_date,
      dto.decision,
      user,
    );
  }
}
