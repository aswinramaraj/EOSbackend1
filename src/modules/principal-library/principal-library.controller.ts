import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalLibraryService } from './principal-library.service';

@Controller('principal-library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalLibraryController {
  constructor(private readonly service: PrincipalLibraryService) {}

  /** GET /principal-library/overview — inventory totals + category-wise breakdown. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
