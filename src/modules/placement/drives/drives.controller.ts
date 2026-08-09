import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DrivesService } from './drives.service';
import { CreateDriveDto } from './dto/create-drive.dto';
import { UpdateDriveDto } from './dto/update-drive.dto';
import { ListDrivesQueryDto } from './dto/list-drives-query.dto';
import { CreateDriveApplicationDto } from './dto/create-drive-application.dto';
import { UpdateDriveApplicationStatusDto } from './dto/update-drive-application-status.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Placement drive management — created and run by the Placement Cell (per worflow.md),
 * with Admin retaining oversight access.
 */
@Controller('drives')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PLACEMENT, ROLES.ADMIN)
export class DrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDriveDto) {
    return this.drivesService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: ListDrivesQueryDto) {
    return this.drivesService.findAll(query);
  }

  /** GET /drives/for-calendar — Principal only, every real drive's date for the merged academic calendar. */
  @Get('for-calendar')
  @Roles(ROLES.PRINCIPAL)
  getAllDrivesForCalendar() {
    return this.drivesService.getAllDrivesForCalendar();
  }

  /**
   * GET /drives/department/:departmentId/upcoming — also Principal (any
   * department, via a dropdown - not just Placement Cell/Admin oversight).
   */
  @Get('department/:departmentId/upcoming')
  @Roles(ROLES.PLACEMENT, ROLES.ADMIN, ROLES.PRINCIPAL)
  getUpcomingForDepartment(@Param('departmentId', ParseIntPipe) departmentId: number) {
    return this.drivesService.getUpcomingForDepartment(departmentId);
  }

  /** GET /drives/department/:departmentId/history — also Principal (any department). */
  @Get('department/:departmentId/history')
  @Roles(ROLES.PLACEMENT, ROLES.ADMIN, ROLES.PRINCIPAL)
  getHistoryForDepartment(@Param('departmentId', ParseIntPipe) departmentId: number) {
    return this.drivesService.getHistoryForDepartment(departmentId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.drivesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDriveDto) {
    return this.drivesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.drivesService.remove(id);
  }

  @Post(':id/applications')
  addApplication(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDriveApplicationDto,
  ) {
    return this.drivesService.addApplication(id, dto);
  }

  @Get(':id/applications')
  listApplications(@Param('id', ParseIntPipe) id: number) {
    return this.drivesService.listApplications(id);
  }

  @Patch(':id/applications/:studentId')
  updateApplicationStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpdateDriveApplicationStatusDto,
  ) {
    return this.drivesService.updateApplicationStatus(user, id, studentId, dto);
  }

  @Delete(':id/applications/:studentId')
  removeApplication(
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.drivesService.removeApplication(id, studentId);
  }
}
