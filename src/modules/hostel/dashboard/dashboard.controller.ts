import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { HostelDashboardService } from './dashboard.service';

@Controller('hostel/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class HostelDashboardController {
  constructor(
    private readonly dashboardService: HostelDashboardService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: JwtPayload) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.dashboardService.summary(wardenHostelId);
  }
}
