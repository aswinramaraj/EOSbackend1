import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalLaboratoriesService } from './laboratories.service';

/** GET /api/v1/me/principal/facilities/laboratories — Principal only, read-only. */
@Controller('me/principal/facilities/laboratories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalLaboratoriesController {
  constructor(
    private readonly laboratoriesService: PrincipalLaboratoriesService,
  ) {}

  @Get()
  list() {
    return this.laboratoriesService.list();
  }
}
