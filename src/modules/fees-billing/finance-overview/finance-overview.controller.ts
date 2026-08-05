import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FinanceOverviewService } from './finance-overview.service';

@Controller()
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceOverviewController {
  constructor(
    private readonly financeOverviewService: FinanceOverviewService,
  ) {}

  /**
   * GET /api/v1/finance-overview
   *
   * Single consolidated read for the Finance Overview dashboard:
   * executiveKPIs, financialAnalytics, operationalInsights — all derived
   * from one Prisma transaction snapshot.
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get('finance-overview')
  getOverview() {
    return this.financeOverviewService.getOverview();
  }
}
