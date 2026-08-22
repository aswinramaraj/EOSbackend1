import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorCourseProgressService } from './academic-coordinator-course-progress.service';

/** GET /api/v1/me/coordinator/course-progress — Academic Coordinator only, read-only. */
@Controller('me/coordinator/course-progress')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorCourseProgressController {
  constructor(
    private readonly service: AcademicCoordinatorCourseProgressService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }
}
