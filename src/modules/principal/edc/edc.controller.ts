import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalEdcService } from './edc.service';
import { ListEdcQueryDto } from './dto/list-edc-query.dto';

/** GET /api/v1/me/principal/edc/* — Principal only, read-only. */
@Controller('me/principal/edc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalEdcController {
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
