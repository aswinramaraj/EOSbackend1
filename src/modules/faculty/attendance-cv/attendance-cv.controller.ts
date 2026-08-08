import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceCvService } from './attendance-cv.service';
import { EnrollFaceDto } from './dto/enroll-face.dto';
import { RecognizeAttendanceDto } from './dto/recognize-attendance.dto';

/**
 * Faculty/HoD-facing proxy in front of the Attendance-CV service. See
 * AttendanceCvService's own doc comment for why the mobile app never talks
 * to that service directly.
 */
@Controller('me/classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY, ROLES.HOD)
export class AttendanceCvController {
  constructor(private readonly attendanceCvService: AttendanceCvService) {}

  /**
   * GET /api/v1/me/classes/:class_id/face-enrollment-roster — advisor of
   * :class_id only. Backs the "Enroll student faces" screen's class-picker
   * follow-up: every student in the class plus their current
   * face_enrolled_at, so the advisor can see at a glance who still needs
   * enrolling.
   *
   * Error responses:
   *  401 UNAUTHORIZED      – missing/invalid access token
   *  403 FORBIDDEN         – authenticated but not Faculty/HoD
   *  403 NOT_CLASS_ADVISOR – caller is not this class's advisor
   *  404 FACULTY_NOT_FOUND – no faculty profile for the authenticated user
   */
  @Get(':class_id/face-enrollment-roster')
  getEnrollmentRoster(@Param('class_id', ParseIntPipe) classId: number, @CurrentUser() user: JwtPayload) {
    return this.attendanceCvService.getEnrollmentRoster(classId, user.sub);
  }

  /**
   * POST /api/v1/me/classes/:class_id/students/:student_id/face-enrollment
   * — advisor of :class_id only.
   *
   * Error responses:
   *  400 VALIDATION_ERROR         – missing/invalid images array
   *  400 STUDENT_NOT_IN_CLASS     – student_id doesn't belong to class_id
   *  400 ATTENDANCE_CV_REJECTED   – no usable face captured in any photo
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated but not Faculty/HoD
   *  403 NOT_CLASS_ADVISOR        – caller is not this class's advisor
   *  404 STUDENT_NOT_FOUND        – no student with the given id
   *  409 ATTENDANCE_CV_DUPLICATE_FACE – this face is already enrolled as someone else
   *  503 ATTENDANCE_CV_NOT_CONFIGURED / ATTENDANCE_CV_UNREACHABLE
   */
  @Post(':class_id/students/:student_id/face-enrollment')
  enrollStudentFace(
    @Param('class_id', ParseIntPipe) classId: number,
    @Param('student_id', ParseIntPipe) studentId: number,
    @Body() dto: EnrollFaceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceCvService.enrollStudentFace(classId, studentId, dto, user.sub);
  }

  /**
   * POST /api/v1/me/classes/:class_id/attendance/recognize — any faculty
   * mapped to teach dto.subject_id for :class_id (same check as
   * POST /me/classes/:class_id/attendance). Read-only: returns a draft,
   * persists nothing - see AttendanceCvService.recognizeAttendance.
   *
   * dto.images is optional - omit it (or send subject_id alone) to fetch
   * the plain class roster with no AI suggestions (suggested_status: null
   * per student, analyzed: false) - this is how the mobile screen loads
   * its manual marking grid as soon as a class/subject is picked, before
   * any photo has been taken.
   *
   * Error responses:
   *  400 VALIDATION_ERROR       – missing/invalid subject_id, or images present but invalid
   *  401 UNAUTHORIZED           – missing/invalid access token
   *  403 FORBIDDEN              – authenticated but not Faculty/HoD
   *  403 NOT_MAPPED_TO_TEACH    – caller doesn't teach this subject to this class
   *  503 ATTENDANCE_CV_NOT_CONFIGURED / ATTENDANCE_CV_UNREACHABLE (only when images were sent)
   */
  @Post(':class_id/attendance/recognize')
  recognizeAttendance(
    @Param('class_id', ParseIntPipe) classId: number,
    @Body() dto: RecognizeAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceCvService.recognizeAttendance(classId, dto, user.sub);
  }
}
