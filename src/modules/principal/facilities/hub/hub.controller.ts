import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacilitiesHubService } from './hub.service';

/** GET /api/v1/me/principal/facilities/hub — Principal only, read-only. */
@Controller('me/principal/facilities/hub')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalFacilitiesHubController {
  constructor(private readonly hubService: PrincipalFacilitiesHubService) {}

  @Get()
  summary() {
    return this.hubService.summary();
  }
}
