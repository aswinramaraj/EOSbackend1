import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import {
  PrincipalLibraryService,
  type LibraryStatusFilter,
} from './library.service';

/** GET /api/v1/me/principal/facilities/library/* — Principal only, read-only. */
@Controller('me/principal/facilities/library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalLibraryController {
  constructor(private readonly libraryService: PrincipalLibraryService) {}

  @Get('summary')
  summary() {
    return this.libraryService.summary();
  }

  @Get('books')
  list(@Query('status') status?: string, @Query('q') q?: string) {
    const validStatuses: LibraryStatusFilter[] = [
      'all',
      'available',
      'partial',
      'out',
    ];
    const resolved = validStatuses.includes(status as LibraryStatusFilter)
      ? (status as LibraryStatusFilter)
      : 'all';
    return this.libraryService.list(resolved, q);
  }
}
