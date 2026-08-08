import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { DrivesService } from './drives.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Faculty-facing placement views — the Placements tile's Upcoming Drives
 * (institution-wide, no per-application status) and History tab (mentored
 * students, drill into one student's own placement history). Distinct from
 * StudentDrivesController (the student's own self-service view) and
 * DrivesController (Placement Cell/Admin management, gated to those roles
 * only - faculty have no write access here).
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class MeDrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Get('upcoming-drives')
  getUpcomingDrives() {
    return this.drivesService.getUpcomingDrivesForFaculty();
  }

  @Get('mentored-students')
  getMentoredStudents(@CurrentUser() user: JwtPayload) {
    return this.drivesService.getMentoredStudents(user.sub);
  }

  @Get('mentored-students/:studentId/placement-history')
  getStudentPlacementHistory(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.drivesService.getStudentPlacementHistoryForMentor(
      studentId,
      user.sub,
    );
  }
}
