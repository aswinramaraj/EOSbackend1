import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFinanceService } from './principal-finance.service';

@Controller('principal-finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalFinanceController {
  constructor(private readonly service: PrincipalFinanceService) {}

  /** GET /principal-finance/overview — fee collection, scholarships, expenditure oversight (aggregate only). */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
