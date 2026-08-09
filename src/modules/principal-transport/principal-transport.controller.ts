import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalTransportService } from './principal-transport.service';

@Controller('principal-transport')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalTransportController {
  constructor(private readonly service: PrincipalTransportService) {}

  /** GET /principal-transport/overview — fleet totals + route-wise breakdown. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
