import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from 'src/modules/principal/faculty/faculty.service';
import { ListPrincipalFacultyQueryDto } from 'src/modules/principal/faculty/dto/list-principal-faculty-query.dto';

/**
 * GET /api/v1/me/iqac/faculty/* — IQAC only, read-only.
 *
 * IQAC's own "Faculty & staff" register. Delegates straight to
 * PrincipalFacultyService rather than forking a second, duplicate
 * real-data query.
 */
@Controller('me/iqac/faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacFacultyController {
  constructor(private readonly facultyService: PrincipalFacultyService) {}

  @Get('filters')
  filters() {
    return this.facultyService.filters();
  }

  // IQAC's own screen has no pagination UI and expects every matching row
  // in one response — PrincipalFacultyService.list() now defaults to a
  // 15-row page (see that service's own doc comment), so this forces the
  // max allowed limit to keep IQAC's existing unbounded behavior unchanged.
  @Get()
  list(@Query() query: ListPrincipalFacultyQueryDto) {
    return this.facultyService.list({ ...query, limit: query.limit ?? 100 });
  }
}
