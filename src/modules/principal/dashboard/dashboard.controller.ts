import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalDashboardService } from './dashboard.service';

/** GET /api/v1/me/principal/dashboard/summary — Principal only. */
@Controller('me/principal/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalDashboardController {
  constructor(private readonly dashboardService: PrincipalDashboardService) {}

  /**
   * `period` defaults to today's original behaviour (unchanged response
   * shape) — only 'term'/'year' route to the new period-aware aggregation.
   */
  @Get('summary')
  summary(@Query('period') period?: string) {
    if (period === 'term' || period === 'year') {
      return this.dashboardService.summaryForPeriod(period);
    }
    if (period !== undefined && period !== 'today') {
      throw new BadRequestException({
        message: `Invalid period "${period}" — expected "today", "term", or "year"`,
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.dashboardService.summary();
  }

  @Get('insights')
  insights() {
    return this.dashboardService.insights();
  }
}
