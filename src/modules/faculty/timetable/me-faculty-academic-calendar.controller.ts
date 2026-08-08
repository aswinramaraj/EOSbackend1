import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetableService } from './timetable.service';

/**
 * GET /api/v1/me/faculty-academic-calendar — Faculty/HoD.
 *
 * A separate controller (not the student MeController) because
 * GET /me/academic-calendar is already claimed and hard-locked to
 * @Roles(ROLES.STUDENT) - same reasoning as the other faculty self-scoped
 * timetable endpoints. Registered in this same TimetableModule since it
 * reuses the identical faculty_subject_class_mapping resolution already
 * built for getCurrentSemesterForFaculty/findFullWeekForFaculty.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeFacultyAcademicCalendarController {
  constructor(private readonly timetableService: TimetableService) {}

  @Get('faculty-academic-calendar')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMyAcademicCalendar(@CurrentUser() user: JwtPayload) {
    return this.timetableService.getMergedAcademicCalendarForFaculty(user.sub);
  }
}
