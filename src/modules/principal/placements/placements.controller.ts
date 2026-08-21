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
import { PrincipalPlacementsService } from './placements.service';

/** GET /api/v1/me/principal/placements/* — Principal only, read-only. */
@Controller('me/principal/placements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalPlacementsController {
  constructor(private readonly placementsService: PrincipalPlacementsService) {}

  @Get('summary')
  summary() {
    return this.placementsService.summary();
  }

  @Get('departments')
  listDepartments() {
    return this.placementsService.listDepartments();
  }

  @Get('departments/:id')
  findDepartment(@Param('id', ParseIntPipe) id: number) {
    return this.placementsService.findDepartment(id);
  }

  @Get('departments/:id/sections')
  sections(@Param('id', ParseIntPipe) id: number) {
    return this.placementsService.sections(id);
  }
}
