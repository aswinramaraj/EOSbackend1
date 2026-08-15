import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationDashboardService } from './higher-education-dashboard.service';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationDashboardController {
  constructor(private readonly service: HigherEducationDashboardService) {}

  /** GET /api/v1/me/higher-education-dashboard — aspirant pipeline, admits, scholarships and readiness for the Higher Education Cell. */
  @Get('higher-education-dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }
}
