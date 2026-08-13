import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodReportsService } from './hod-reports.service';

/**
 * HoD Reports & Analytics — HoD only. Every method resolves the caller's own
 * department server-side (via their faculty row) rather than trusting a
 * client-supplied department_id, so one HoD can never pull another
 * department's figures by tampering with a query param.
 */
@Controller('hod/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodReportsController {
  constructor(private readonly hodReportsService: HodReportsService) {}

  /** GET /api/v1/hod/reports/summary — department pass %, avg CGPA, arrears, distinctions, each vs previous semester. */
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.hodReportsService.getSummary(user.sub);
  }

  /** GET /api/v1/hod/reports/classes?year=II — pass % by class, current vs previous semester. */
  @Get('classes')
  getClassPassRates(
    @CurrentUser() user: JwtPayload,
    @Query('year') year?: string,
  ) {
    return this.hodReportsService.getClassPassRates(user.sub, year);
  }

  /** GET /api/v1/hod/reports/subjects — subject-wise pass % per section, grouped by year/semester. */
  @Get('subjects')
  getSubjectResults(@CurrentUser() user: JwtPayload) {
    return this.hodReportsService.getSubjectResults(user.sub);
  }
}
