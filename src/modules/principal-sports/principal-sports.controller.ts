import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalSportsService } from './principal-sports.service';

@Controller('principal-sports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalSportsController {
  constructor(private readonly service: PrincipalSportsService) {}

  /** GET /principal-sports/overview — participation + equipment, team-wise breakdown. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
