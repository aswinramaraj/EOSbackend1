import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalMedicalService } from './principal-medical.service';

@Controller('principal-medical')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalMedicalController {
  constructor(private readonly service: PrincipalMedicalService) {}

  /** GET /principal-medical/overview — this month's visits + department-wise breakdown. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
