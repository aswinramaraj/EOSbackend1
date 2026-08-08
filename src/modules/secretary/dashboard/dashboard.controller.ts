import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { SecretaryDashboardService } from './dashboard.service';

/** GET /api/v1/me/secretary/dashboard/summary — Secretary only. */
@Controller('me/secretary/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY)
export class SecretaryDashboardController {
  constructor(private readonly dashboardService: SecretaryDashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.summary(user);
  }
}
