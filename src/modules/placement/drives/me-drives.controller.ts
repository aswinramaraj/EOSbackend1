import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DrivesService } from './drives.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Faculty/HoD-facing placement views — the Placements tile's Upcoming
 * Drives (institution-wide, no per-application status, shared by both
 * roles) and History tab, which is scoped differently per role: a faculty
 * mentor sees only their own mentored classes (via class_mentors), a HoD
 * sees every class in their own department (via their own faculty row's
 * department_id) - "similar to the advisor [mentor] view, but department-
 * wide". Distinct from StudentDrivesController (the student's own
 * self-service view) and DrivesController (Placement Cell/Admin
 * management, gated to those roles only).
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeDrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Get('upcoming-drives')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  getUpcomingDrives() {
    return this.drivesService.getUpcomingDrivesForFaculty();
  }

  /** GET /me/upcoming-drives/:driveId/applications — real per-mentee
   * application status/round for this drive (student_drive_applications),
   * scoped to the caller's own mentee classes. */
  @Get('upcoming-drives/:driveId/applications')
  @Roles(ROLES.FACULTY)
  getDriveApplications(
    @Param('driveId', ParseIntPipe) driveId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.drivesService.getDriveApplicationsForMentor(driveId, user.sub);
  }

  @Get('mentored-students')
  @Roles(ROLES.FACULTY)
  getMentoredStudents(@CurrentUser() user: JwtPayload) {
    return this.drivesService.getMentoredStudents(user.sub);
  }

  @Get('mentored-students/:studentId/placement-history')
  @Roles(ROLES.FACULTY)
  getStudentPlacementHistory(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.drivesService.getStudentPlacementHistoryForMentor(
      studentId,
      user.sub,
    );
  }

  /** GET /me/department-classes (HoD only) — every class in the HoD's own department, for the class selector. */
  @Get('department-classes')
  @Roles(ROLES.HOD)
  getDepartmentClasses(@CurrentUser() user: JwtPayload) {
    return this.drivesService.getDepartmentClasses(user.sub);
  }

  /**
   * GET /me/department-students (HoD only) — every student in every class
   * of the HoD's own department, or just one class via ?class_id=.
   */
  @Get('department-students')
  @Roles(ROLES.HOD)
  getDepartmentStudents(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', new ParseIntPipe({ optional: true })) classId?: number,
  ) {
    return this.drivesService.getDepartmentStudents(user.sub, classId);
  }

  /** GET /me/department-students/:studentId/placement-history (HoD only — student's class must belong to the HoD's own department). */
  @Get('department-students/:studentId/placement-history')
  @Roles(ROLES.HOD)
  getDepartmentStudentPlacementHistory(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.drivesService.getStudentPlacementHistoryForHod(
      studentId,
      user.sub,
    );
  }
}
