import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PrincipalSearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

/** GET /api/v1/me/principal/search — Principal only, read-only. */
@Controller('me/principal/search')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalSearchController {
  constructor(private readonly searchService: PrincipalSearchService) {}

  @Get()
  search(@Query() query: SearchQueryDto, @CurrentUser() user: JwtPayload) {
    return this.searchService.search(query.q, user);
  }
}
