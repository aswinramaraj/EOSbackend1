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
import { HrDepartmentsService } from './hr-departments.service';

/**
 * HR's institution-wide department view — HR Payroll only. Reuses the same
 * `departments` table every other module uses; department here is a data
 * filter/rollup, not a separate HR-specific concept.
 */
@Controller('hr/departments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HR_PAYROLL)
export class HrDepartmentsController {
  constructor(private readonly hrDepartmentsService: HrDepartmentsService) {}

  /** GET /api/v1/hr/departments — every department with live rollup counts. */
  @Get()
  findAll() {
    return this.hrDepartmentsService.findAll();
  }

  /** GET /api/v1/hr/departments/:id — one department's rollup. */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hrDepartmentsService.findOne(id);
  }
}
