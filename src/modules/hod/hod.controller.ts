import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodService } from './hod.service';
import { HodReportsService } from './hod-reports.service';
import { QueryHodDashboardDto } from './dto/query-hod-dashboard.dto';
import { QueryHodClassPassRatesDto } from './dto/query-hod-class-pass-rates.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod')
export class HodController {
  constructor(
    private readonly hodService: HodService,
    private readonly hodReportsService: HodReportsService,
  ) {}

  @Get('dashboard')
  @Roles(ROLES.HOD)
  getDashboard(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryHodDashboardDto,
  ) {
    return this.hodService.getDashboard(user, query.scope ?? 'today');
  }

  @Get('reports/summary')
  @Roles(ROLES.HOD)
  getReportsSummary(@CurrentUser() user: JwtPayload) {
    return this.hodReportsService.getSummary(user);
  }

  @Get('reports/classes')
  @Roles(ROLES.HOD)
  getReportsClasses(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryHodClassPassRatesDto,
  ) {
    return this.hodReportsService.getClassPassRates(user, query.year ?? null);
  }

  @Get('reports/subjects')
  @Roles(ROLES.HOD)
  getReportsSubjects(@CurrentUser() user: JwtPayload) {
    return this.hodReportsService.getSubjectResults(user);
  }
}
