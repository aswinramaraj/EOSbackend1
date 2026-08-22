import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from 'src/modules/principal/faculty/faculty.service';
import { ListPrincipalFacultyQueryDto } from 'src/modules/principal/faculty/dto/list-principal-faculty-query.dto';
import { AcademicCoordinatorFacultyService } from './academic-coordinator-faculty.service';

/** GET /api/v1/me/coordinator/faculty/* — Academic Coordinator only, read-only, institution-wide. */
@Controller('me/coordinator/faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorFacultyController {
  constructor(
    private readonly principalFacultyService: PrincipalFacultyService,
    private readonly facultyService: AcademicCoordinatorFacultyService,
  ) {}

  /** Reuses the exact same cross-department directory the Principal module already exposes — no reason to duplicate it. */
  @Get()
  list(@Query() query: ListPrincipalFacultyQueryDto) {
    return this.principalFacultyService.list(query);
  }

  @Get('workload')
  workload() {
    return this.facultyService.workload();
  }

  @Get(':id')
  profile(@Param('id') id: string) {
    return this.facultyService.profile(+id);
  }
}
