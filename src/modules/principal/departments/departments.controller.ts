import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalDepartmentsService } from './departments.service';
import { AssignHodDto } from './dto/assign-hod.dto';

/** GET/PATCH /api/v1/me/principal/departments/* — Principal only. */
@Controller('me/principal/departments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalDepartmentsController {
  constructor(
    private readonly departmentsService: PrincipalDepartmentsService,
  ) {}

  @Get()
  list() {
    return this.departmentsService.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.findOne(id);
  }

  @Get(':id/sections')
  sections(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.sections(id);
  }

  @Patch(':id/hod')
  assignHod(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignHodDto) {
    return this.departmentsService.assignHod(id, dto);
  }
}
