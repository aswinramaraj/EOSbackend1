import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodMyClassService } from './hod-my-class.service';
import { MarkHodAssignmentStatusDto } from './dto/mark-hod-assignment-status.dto';

// Attendance for a HOD's own handled class is deliberately NOT here —
// it now reuses the exact same faculty flow (MeClassesAttendanceController,
// POST/GET /me/classes/:class_id/attendance*) as any other faculty member,
// since resolveFacultyByUserId there is already role-agnostic. This module
// used to carry its own parallel getAttendanceOverview/markAttendance
// (no draft/publish distinction — attendance went live immediately on
// save), which is exactly the inconsistency that got fixed.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/my-class')
export class HodMyClassController {
  constructor(private readonly hodMyClass: HodMyClassService) {}

  @Get('current-semester')
  @Roles(ROLES.HOD)
  getCurrentSemester(@CurrentUser() user: JwtPayload) {
    return this.hodMyClass.getCurrentSemester(user);
  }

  @Get('subject-records')
  @Roles(ROLES.HOD)
  getSubjectRecords(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('semester') semester?: string,
  ) {
    return this.hodMyClass.getSubjectRecords(
      user,
      classId != null ? Number(classId) : undefined,
      subjectId != null ? Number(subjectId) : undefined,
      semester != null ? Number(semester) : undefined,
    );
  }

  @Get('assignment-status')
  @Roles(ROLES.HOD)
  getAssignmentStatus(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('assignment_id') assignmentId?: string,
  ) {
    return this.hodMyClass.getAssignmentStatus(
      user,
      classId != null ? Number(classId) : undefined,
      subjectId != null ? Number(subjectId) : undefined,
      assignmentId != null ? Number(assignmentId) : undefined,
    );
  }

  @Patch('assignment-status/mark')
  @Roles(ROLES.HOD)
  markAssignmentStatus(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkHodAssignmentStatusDto,
  ) {
    return this.hodMyClass.markAssignmentStatus(user, dto);
  }
}
