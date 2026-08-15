import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalMedicalService } from './medical.service';

/** GET /api/v1/me/principal/facilities/medical/* — Principal only, read-only. */
@Controller('me/principal/facilities/medical')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalMedicalController {
  constructor(private readonly medicalService: PrincipalMedicalService) {}

  @Get('summary')
  summary() {
    return this.medicalService.summary();
  }

  @Get('team')
  team() {
    return this.medicalService.team();
  }

  @Get('treatment-log')
  treatmentLog() {
    return this.medicalService.treatmentLog();
  }

  @Get('equipment')
  equipment() {
    return this.medicalService.equipment();
  }
}
