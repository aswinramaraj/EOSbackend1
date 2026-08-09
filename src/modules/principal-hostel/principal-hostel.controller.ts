import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalHostelService } from './principal-hostel.service';

@Controller('principal-hostel')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalHostelController {
  constructor(private readonly service: PrincipalHostelService) {}

  /** GET /principal-hostel/overview — occupancy totals + block-wise breakdown. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }
}
