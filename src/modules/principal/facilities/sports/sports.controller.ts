import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalSportsService } from './sports.service';

/** GET /api/v1/me/principal/facilities/sports/* — Principal only, read-only. */
@Controller('me/principal/facilities/sports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalSportsController {
  constructor(private readonly sportsService: PrincipalSportsService) {}

  @Get('summary')
  summary() {
    return this.sportsService.summary();
  }

  @Get('faculty')
  faculty() {
    return this.sportsService.faculty();
  }

  @Get('achievements')
  achievements() {
    return this.sportsService.achievements();
  }
}
