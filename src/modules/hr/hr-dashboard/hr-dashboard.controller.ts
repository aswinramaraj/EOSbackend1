import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HrDashboardService } from './hr-dashboard.service';

/** HR Dashboard summary — HR Payroll only. */
@Controller('hr/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HR_PAYROLL)
export class HrDashboardController {
  constructor(private readonly hrDashboardService: HrDashboardService) {}

  /** GET /api/v1/hr/dashboard — pending requests, today's leave/OD, pending appraisals, payroll, department overview. */
  @Get()
  getSummary() {
    return this.hrDashboardService.getSummary();
  }
}
