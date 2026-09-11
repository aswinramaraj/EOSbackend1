import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalPlacementsService } from './principal-placements.service';

@Controller('principal-placements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalPlacementsController {
  constructor(private readonly service: PrincipalPlacementsService) {}

  /** GET /principal-placements/overview — season stats + department-wise placement %. */
  @Get('overview')
  getOverview(@CurrentUser() user: JwtPayload) {
    return this.service.getOverview(user);
  }
}
