import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FinanceDashboardService } from './dashboard.service';

@Controller('finance/dashboard')
@Roles(ROLES.FINANCE, ROLES.ADMIN, ROLES.PRINCIPAL)
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceDashboardController {
  constructor(private readonly service: FinanceDashboardService) {}

  /** GET /api/v1/finance/dashboard */
  @Get()
  overview() {
    return this.service.overview();
  }
}
