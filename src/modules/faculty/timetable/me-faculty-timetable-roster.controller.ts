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

  @Get('academic-calendar-institution')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL, ROLES.PRINCIPAL, ROLES.HIGHER_EDUCATION)
  getInstitutionAcademicCalendar() {
    return this.timetableService.getInstitutionAcademicCalendar();
  }
}
