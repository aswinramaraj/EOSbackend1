import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalHigherEducationService } from 'src/modules/principal/higher-education/higher-education.service';
import { ListHigherEducationQueryDto } from 'src/modules/principal/higher-education/dto/list-higher-education-query.dto';

/**
 * GET /api/v1/me/iqac/higher-education/* — IQAC only, read-only.
 *
 * IQAC's own "Higher education" page. Delegates straight to
 * PrincipalHigherEducationService rather than forking a second, duplicate
 * real-data query.
 */
@Controller('me/iqac/higher-education')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacHigherEducationController {
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
}
