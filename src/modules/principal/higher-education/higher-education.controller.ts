import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalHigherEducationService } from './higher-education.service';
import { ListHigherEducationQueryDto } from './dto/list-higher-education-query.dto';

/** GET /api/v1/me/principal/higher-education/* — Principal only, read-only. */
@Controller('me/principal/higher-education')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalHigherEducationController {
  constructor(
    private readonly higherEducationService: PrincipalHigherEducationService,
  ) {}

  @Get('filters')
  filters() {
    return this.higherEducationService.filters();
  }

  @Get('summary')
  summary() {
    return this.higherEducationService.summary();
  }

  @Get()
  list(@Query() query: ListHigherEducationQueryDto) {
    return this.higherEducationService.list(query);
  }

  /** GET /me/principal/higher-education/:id/profile — full Higher-Education Profile detail screen. */
  @Get(':id/profile')
  getProfile(@Param('id', ParseIntPipe) id: number) {
    return this.higherEducationService.getProfile(id);
  }
}
