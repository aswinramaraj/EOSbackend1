import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalExamsService } from './principal-exams.service';

@Controller('principal-exams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalExamsController {
  constructor(private readonly service: PrincipalExamsService) {}

  /** GET /principal-exams/overview — pass rate, arrears, CGPA, revaluations, department-wise results. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
