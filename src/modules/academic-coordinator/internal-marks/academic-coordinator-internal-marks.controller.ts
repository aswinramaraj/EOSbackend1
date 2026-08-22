import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorInternalMarksService } from './academic-coordinator-internal-marks.service';

/** GET /api/v1/me/coordinator/internal-marks — Academic Coordinator only, read-only. */
@Controller('me/coordinator/internal-marks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorInternalMarksController {
  constructor(
    private readonly service: AcademicCoordinatorInternalMarksService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }
}
