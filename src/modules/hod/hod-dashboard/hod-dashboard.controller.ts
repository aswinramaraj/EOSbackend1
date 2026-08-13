import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodDashboardService } from './hod-dashboard.service';

/** HoD Dashboard — HoD only. Always scoped to the caller's own department, resolved server-side. */
@Controller('hod/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodDashboardController {
  constructor(private readonly hodDashboardService: HodDashboardService) {}

  /** GET /api/v1/hod/dashboard?scope=today|term */
  @Get()
  getSummary(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    return this.hodDashboardService.getSummary(
      user.sub,
      scope === 'term' ? 'term' : 'today',
    );
  }
}
