import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFinanceService } from './finance.service';

/** GET /api/v1/me/principal/finance/* — Principal only, read-only oversight (transaction-level accounting stays with the Finance office). */
@Controller('me/principal/finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalFinanceController {
  constructor(private readonly financeService: PrincipalFinanceService) {}

  @Get('summary')
  summary() {
    return this.financeService.summary();
  }

  @Get('collection-by-year')
  collectionByYear() {
    return this.financeService.collectionByYear();
  }

  @Get('fee-heads')
  feeHeadBreakdown() {
    return this.financeService.feeHeadBreakdown();
  }

  @Get('dues-by-age')
  duesByAge() {
    return this.financeService.duesByAge();
  }

  @Get('scholarships')
  scholarships() {
    return this.financeService.scholarships();
  }

  @Get('budget')
  budget() {
    return this.financeService.budget();
  }
}
