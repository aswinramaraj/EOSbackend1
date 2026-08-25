import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalDepartmentsService } from 'src/modules/principal/departments/departments.service';
import { IqacDepartmentsService } from './iqac-departments.service';

/**
 * GET /api/v1/me/iqac/departments/* — IQAC only, read-only.
 *
 * IQAC's own "Departments & HoDs" register. Delegates straight to
 * PrincipalDepartmentsService rather than forking a second, duplicate
 * real-data query. Deliberately has no `PATCH .../hod` route at all —
 * assigning a Head of Department is a Principal-only administrative
 * action, not something this controller exposes in any form.
 * `naac-readiness` is a new aggregate (see IqacDepartmentsService) over
 * IQAC's own iqac_accreditation_criteria table.
 */
@Controller('me/iqac/departments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacDepartmentsController {
  constructor(
    private readonly departmentsService: PrincipalDepartmentsService,
    private readonly iqacDepartments: IqacDepartmentsService,
  ) {}

  @Get()
  list() {
    return this.departmentsService.list();
  }

  @Get('naac-readiness')
  naacReadiness() {
    return this.iqacDepartments.naacReadiness();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.findOne(id);
  }

  @Get(':id/sections')
  sections(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.sections(id);
  }
}
