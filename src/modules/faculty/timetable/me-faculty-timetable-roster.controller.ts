import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetableService } from './timetable.service';

/**
 * HoD/HR Payroll/Principal browsing another faculty member's timetable,
 * department by department - distinct from MeFacultyTimetableController's
 * GET /me/faculty-timetable, which is hard-locked to the caller's own
 * schedule. Registered in this same TimetableModule, delegates to the
 * existing TimetableService. Principal reuses this exact flow (department
 * -> faculty -> that faculty's real timetable) rather than a separate
 * screen - see app/(tabs)/academics/timetable/index.tsx.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeFacultyTimetableRosterController {
  constructor(private readonly timetableService: TimetableService) {}

  @Get('timetable-departments')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL, ROLES.PRINCIPAL)
  listDepartments() {
    return this.timetableService.listDepartmentsWithClasses();
  }

  @Get('timetable-departments/:departmentId/faculty')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL, ROLES.PRINCIPAL)
  listFacultyInDepartment(
    @Param('departmentId', ParseIntPipe) departmentId: number,
  ) {
    return this.timetableService.listFacultyInDepartment(departmentId);
  }

  @Get('faculty-timetable-roster/:facultyId')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL, ROLES.PRINCIPAL)
  getFacultyTimetable(@Param('facultyId', ParseIntPipe) facultyId: number) {
    return this.timetableService.getFullWeekForFacultyId(facultyId);
  }

  // Every staff role without an "own" batch/semester to scope a calendar to
  // (see academic-calendar.api.ts's doc comment) - i.e. every role except
  // Student/Faculty/Parent, which each already have their own more
  // precisely-scoped calendar endpoint. Read-only institution-wide
  // holiday/event data, not sensitive - safe to open broadly rather than
  // leaving most staff roles unable to load the shared Academic Calendar
  // screen at all.
  @Get('academic-calendar-institution')
  @Roles(
    ROLES.ADMIN,
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.COE,
    ROLES.PLACEMENT,
    ROLES.LIBRARY,
    ROLES.BILLING,
    ROLES.HR_PAYROLL,
    ROLES.FINANCE,
    ROLES.IQAC,
    ROLES.SECRETARY,
    ROLES.GATE_WARDEN,
    ROLES.WARDEN,
    ROLES.MEDIA_ROOM,
    ROLES.ACADEMIC_COORDINATOR,
    ROLES.ALUMNI,
    ROLES.NON_TEACHING_STAFF,
    ROLES.TRANSPORT,
    ROLES.HIGHER_EDUCATION,
    ROLES.MEDICAL_CENTRE,
    ROLES.SPORTS_ADMIN,
    ROLES.EDC_COORDINATOR,
  )
  getInstitutionAcademicCalendar() {
    return this.timetableService.getInstitutionAcademicCalendar();
  }
}
