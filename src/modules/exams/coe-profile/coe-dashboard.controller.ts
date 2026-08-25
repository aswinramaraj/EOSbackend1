import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { CoeDashboardService } from './coe-dashboard.service';

@Controller('coe/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class CoeDashboardController {
  constructor(private readonly service: CoeDashboardService) {}

  @Get('summary')
  async getSummary(@Query('period') period?: 'today' | 'cycle' | 'year') {
    const summary = await this.service.getSummary(period ?? 'cycle');
    return ApiResponse.ok(summary, 'Dashboard summary fetched successfully.');
  }
}
