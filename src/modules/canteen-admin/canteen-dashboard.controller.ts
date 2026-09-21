import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenDashboardService } from './canteen-dashboard.service';

@Controller('canteen-admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenDashboardController {
  constructor(private readonly dashboard: CanteenDashboardService) {}

  @Get()
  get() {
    return this.dashboard.getDashboard();
  }
}
