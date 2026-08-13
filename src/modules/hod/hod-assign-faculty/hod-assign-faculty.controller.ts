import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodAssignFacultyService } from './hod-assign-faculty.service';

@Controller('hod/assign-faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodAssignFacultyController {
  constructor(
    private readonly hodAssignFacultyService: HodAssignFacultyService,
  ) {}

  /** GET /api/v1/hod/assign-faculty?class_id= */
  @Get()
  getAssignments(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
  ) {
    return this.hodAssignFacultyService.getAssignments(
      user.sub,
      classId ? Number(classId) : undefined,
    );
  }

  /** PATCH /api/v1/hod/assign-faculty/handling-faculty */
  @Patch('handling-faculty')
  setHandlingFaculty(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { class_id: number; subject_id: number; faculty_id: number },
  ) {
    return this.hodAssignFacultyService.setHandlingFaculty(
      user.sub,
      Number(body.class_id),
      Number(body.subject_id),
      Number(body.faculty_id),
    );
  }

  /** PATCH /api/v1/hod/assign-faculty/substitute-faculty — faculty_id: null clears the substitute. */
  @Patch('substitute-faculty')
  setSubstituteFaculty(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { class_id: number; subject_id: number; faculty_id: number | null },
  ) {
    return this.hodAssignFacultyService.setSubstituteFaculty(
      user.sub,
      Number(body.class_id),
      Number(body.subject_id),
      body.faculty_id != null ? Number(body.faculty_id) : null,
    );
  }
}
