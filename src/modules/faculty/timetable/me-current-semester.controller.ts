import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetableService } from './timetable.service';

/**
 * GET /api/v1/me/current-semester — Faculty/HoD.
 *
 * A separate controller (not TimetableController/MeClassesController)
 * because the required path is /me/current-semester, a distinct top-level
 * path from /timetable and /me/classes - same reasoning as
 * MeClassesController. Registered in this same TimetableModule, delegates
 * to the existing TimetableService. HoD is included because the mobile
 * app's Academics section routes both Faculty and HoD app users through the
 * identical "Current Semester" screen (see AcademicsChooserScreen); a
 * non-teaching HoD legitimately sees an empty subject list, not an error.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeCurrentSemesterController {
  constructor(private readonly timetableService: TimetableService) {}

  @Get('current-semester')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getCurrentSemester(@CurrentUser() user: JwtPayload) {
    return this.timetableService.getCurrentSemesterForFaculty(user.sub);
  }
}
