import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationReportsService } from './higher-education-reports.service';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationReportsController {
  constructor(private readonly service: HigherEducationReportsService) {}

  /** GET /api/v1/me/higher-education-reports — aspirant progression grouped by batch. */
  @Get('higher-education-reports')
  getReports() {
    return this.service.getReports();
  }
}
