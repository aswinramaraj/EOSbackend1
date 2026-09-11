import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PrincipalDepartmentsService } from '../departments/departments.service';
import { AssignHodDto } from '../departments/dto/assign-hod.dto';
import { RoleAllocationService } from './role-allocation.service';

/**
 * GET/PATCH /api/v1/me/principal/role-allocation/* — Principal only.
 *
 * The appoint-HoD mutation deliberately delegates to
 * PrincipalDepartmentsService.assignHod() rather than re-implementing it —
 * same validation (faculty must belong to the department), same
 * audit_logs write, same underlying column. This screen and the
 * Departments & HoDs screen's "Assign HoD" panel are two views onto one
 * action, not two independent ones.
 */
@Controller('me/principal/role-allocation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class RoleAllocationController {
  constructor(
    private readonly roleAllocation: RoleAllocationService,
    private readonly departments: PrincipalDepartmentsService,
  ) {}

  @Get('departments')
  listDepartments() {
    return this.roleAllocation.listDepartments();
  }

  @Get('departments/:id/candidates')
  candidates(@Param('id', ParseIntPipe) id: number) {
    return this.roleAllocation.candidatesForDepartment(id);
  }

  @Get('departments/:id/history')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.roleAllocation.historyForDepartment(id);
  }

  @Patch('departments/:id/hod')
  appointHod(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignHodDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.departments.assignHod(id, dto, user.sub);
  }
}
