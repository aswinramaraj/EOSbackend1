import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetableService } from './timetable.service';

/**
 * GET /api/v1/me/faculty-timetable — Faculty/HoD.
 *
 * A separate controller (not MeTimetableController) because GET /me/timetable
 * is already claimed and hard-locked to @Roles(ROLES.STUDENT) - same
 * reasoning as MeClassesController/MeCurrentSemesterController: a distinct
 * self-scoped path gets its own controller rather than widening an existing
 * one's roles. Registered in this same TimetableModule, delegates to the
 * existing TimetableService.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeFacultyTimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  @Get('faculty-timetable')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getMyTimetable(@CurrentUser() user: JwtPayload) {
    return this.timetableService.findFullWeekForFaculty(user.sub);
  }
}
