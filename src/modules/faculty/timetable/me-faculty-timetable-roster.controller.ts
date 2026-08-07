import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetableService } from './timetable.service';

/**
 * HoD/HR Payroll browsing another faculty member's timetable, department by
 * department - distinct from MeFacultyTimetableController's
 * GET /me/faculty-timetable, which is hard-locked to the caller's own
 * schedule. Registered in this same TimetableModule, delegates to the
 * existing TimetableService.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeFacultyTimetableRosterController {
  constructor(private readonly timetableService: TimetableService) {}

  @Get('timetable-departments')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  listDepartments() {
    return this.timetableService.listDepartmentsWithClasses();
  }

  @Get('timetable-departments/:departmentId/faculty')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  listFacultyInDepartment(
    @Param('departmentId', ParseIntPipe) departmentId: number,
  ) {
    return this.timetableService.listFacultyInDepartment(departmentId);
  }

  @Get('faculty-timetable-roster/:facultyId')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  getFacultyTimetable(@Param('facultyId', ParseIntPipe) facultyId: number) {
    return this.timetableService.getFullWeekForFacultyId(facultyId);
  }

  @Get('academic-calendar-institution')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  getInstitutionAcademicCalendar() {
    return this.timetableService.getInstitutionAcademicCalendar();
  }
}
