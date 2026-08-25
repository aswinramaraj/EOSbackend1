import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { IqacDashboardService } from './iqac-dashboard.service';

/** GET /api/v1/me/iqac/dashboard — IQAC only, read-only institution overview. */
@Controller('me/iqac/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacDashboardController {
  constructor(private readonly dashboard: IqacDashboardService) {}

  @Get()
  overview() {
    return this.dashboard.overview();
  }
}
