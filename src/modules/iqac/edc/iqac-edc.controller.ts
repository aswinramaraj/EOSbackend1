import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalEdcService } from 'src/modules/principal/edc/edc.service';
import { ListEdcQueryDto } from 'src/modules/principal/edc/dto/list-edc-query.dto';

/**
 * GET /api/v1/me/iqac/edc/* — IQAC only, read-only.
 *
 * IQAC's own "EDC" page. Delegates straight to PrincipalEdcService rather
 * than forking a second, duplicate real-data query.
 */
@Controller('me/iqac/edc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacEdcController {
  constructor(private readonly edcService: PrincipalEdcService) {}

  @Get('filters')
  filters() {
    return this.edcService.filters();
  }

  @Get('summary')
  summary() {
    return this.edcService.summary();
  }

  @Get()
  list(@Query() query: ListEdcQueryDto) {
    return this.edcService.list(query);
  }
}
