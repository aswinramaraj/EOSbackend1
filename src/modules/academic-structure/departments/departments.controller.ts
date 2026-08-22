import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AssignHodDto } from './dto/assign-hod.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  /**
   * POST /api/v1/departments
   * Admin only — creates a new department (foundational master data).
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async create(@Body() createDepartmentDto: CreateDepartmentDto) {
    const department =
      await this.departmentsService.create(createDepartmentDto);
    return ApiResponse.created(department, 'Department created successfully');
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.departmentsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.departmentsService.findOne(+id);
  }

  /** PATCH /api/v1/departments/:id — Admin only. */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
  ) {
    return this.departmentsService.update(+id, updateDepartmentDto);
  }

  /** DELETE /api/v1/departments/:id — Admin only. */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  remove(@Param('id') id: string) {
    return this.departmentsService.remove(+id);
  }

  /**
   * PATCH /api/v1/departments/:id/hod — Admin only. Assigns (or, with
   * faculty_id: null, clears) the department's Head of Department.
   */
  @Patch(':id/hod')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  assignHod(@Param('id') id: string, @Body() dto: AssignHodDto) {
    return this.departmentsService.assignHod(+id, dto);
  }
}
