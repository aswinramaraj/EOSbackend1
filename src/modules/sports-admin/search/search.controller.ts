import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { SportsSearchService } from './search.service';

@Controller('sports-admin/search')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class SportsSearchController {
  constructor(private readonly searchService: SportsSearchService) {}

  @Get()
  search(@Query('q') q: string) {
    return this.searchService.search(q ?? '');
  }
}
