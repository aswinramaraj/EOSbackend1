import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreDashboardService, type DashboardRange } from './medical-centre-dashboard.service';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreDashboardController {
  constructor(private readonly service: MedicalCentreDashboardService) {}

  /** GET /api/v1/me/medical-centre-dashboard?range=today|week|year */
  @Get('medical-centre-dashboard')
  getDashboard(@Query('range') range?: string) {
    const validRange: DashboardRange = range === 'week' || range === 'year' ? range : 'today';
    return this.service.getDashboard(validRange);
  }
}
