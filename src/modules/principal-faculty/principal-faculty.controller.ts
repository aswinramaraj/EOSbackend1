import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from './principal-faculty.service';

@Controller('principal-faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalFacultyController {
  constructor(private readonly service: PrincipalFacultyService) {}

  /** GET /principal-faculty/overview — headcount, duty/appraisal/payroll stats, department-wise strength. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
