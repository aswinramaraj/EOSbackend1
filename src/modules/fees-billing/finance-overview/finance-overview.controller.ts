import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FinanceOverviewService } from './finance-overview.service';

@Controller()
@Roles(ROLES.ADMIN, ROLES.BILLING)
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceOverviewController {
  constructor(
    private readonly financeOverviewService: FinanceOverviewService,
  ) {}

  /**
   * GET /api/v1/finance-overview/batches
   *
   * Real batch names (e.g. "2024-2028") that have at least one student with
   * a fee demand mapping — for populating the "All / <batch> / ..." filter.
   * Registered before ':id'-less 'finance-overview' route below so it isn't
   * ever shadowed (there is no dynamic segment here to conflict with, but
   * kept in this order for clarity).
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Roles(ROLES.ADMIN, ROLES.BILLING, ROLES.FINANCE)
  @Get('finance-overview/batches')
  getAvailableBatches() {
    return this.financeOverviewService.getAvailableBatches();
  }

  /**
   * GET /api/v1/finance-overview?batch=<batch name>
   *
   * Single consolidated read for the Finance Overview dashboard:
   * executiveKPIs, financialAnalytics, operationalInsights — all derived
   * from one Prisma transaction snapshot.
   *
   * `batch` is optional — omit it (the "All" case) for the exact same
   * unscoped aggregate this endpoint always returned. Pass a real batch
   * name (from GET /finance-overview/batches) to scope every section to
   * only that batch's students.
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Roles(ROLES.ADMIN, ROLES.BILLING, ROLES.FINANCE)
  @Get('finance-overview')
  getOverview(@Query('batch') batch?: string) {
    return this.financeOverviewService.getOverview(batch);
  }
}
