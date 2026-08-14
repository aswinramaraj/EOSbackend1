import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { SportsDashboardService } from './dashboard.service';
import { GetDashboardQueryDto } from './dto/get-dashboard-query.dto';

@Controller('sports-admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class SportsDashboardController {
  constructor(private readonly dashboardService: SportsDashboardService) {}

  @Get()
  getOverview(@Query() query: GetDashboardQueryDto) {
    return this.dashboardService.getOverview(query.timeframe ?? 'today');
  }
}
