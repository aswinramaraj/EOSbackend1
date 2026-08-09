import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalDepartmentsService } from './principal-departments.service';

@Controller('principal-departments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalDepartmentsController {
  constructor(private readonly service: PrincipalDepartmentsService) {}

  /** GET /principal-departments/overview — per-department strength, HoD, attendance and placement outcomes. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
