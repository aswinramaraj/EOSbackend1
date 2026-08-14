import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelDashboardService } from './dashboard.service';

@Controller('hostel/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.WARDEN)
export class HostelDashboardController {
  constructor(private readonly dashboardService: HostelDashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboardService.summary();
  }
}
