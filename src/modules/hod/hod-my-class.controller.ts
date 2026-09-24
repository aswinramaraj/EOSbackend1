import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodMyClassService } from './hod-my-class.service';

// Attendance for a HOD's own handled class is deliberately NOT here —
// it now reuses the exact same faculty flow (MeClassesAttendanceController,
// POST/GET /me/classes/:class_id/attendance*) as any other faculty member,
// since resolveFacultyByUserId there is already role-agnostic. This module
// used to carry its own parallel getAttendanceOverview/markAttendance
// (no draft/publish distinction — attendance went live immediately on
// save), which is exactly the inconsistency that got fixed.
//
// GET current-semester was removed the same way — GET /me/current-semester
// (TimetableService.getCurrentSemesterForFaculty, already @Roles(FACULTY,
// HOD)) is the exact same data, and had a year-parsing bugfix this HOD-only
// copy never received. See HodMyClassService.getHandledClasses for the
// ported fix (still needed here as a private helper for the two routes
// below).
//
// subject-records stays HOD-scoped in URL only for historical reasons —
// widened to FACULTY too (any teaching faculty, not just a HoD who also
// teaches, wants a gradebook view), reusing the same resolveFaculty(user)
// (caller's own faculty row) it already uses.
//
// GET assignment-status / PATCH assignment-status/mark were removed —
// confirmed zero frontend consumers (see HodMyClassService's own comment).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/my-class')
export class HodMyClassController {
  constructor(private readonly hodMyClass: HodMyClassService) {}

  @Get('subject-records')
  @Roles(ROLES.FACULTY, ROLES.HOD)
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
}
