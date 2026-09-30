import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateDepartmentDto } from 'src/modules/academic-structure/departments/dto/create-department.dto';
import { CreateCourseDto } from 'src/modules/academic-structure/courses/dto/create-course.dto';
import { CreateBatchDto } from 'src/modules/academic-structure/batches/dto/create-batch.dto';
import { CreateClassDto } from 'src/modules/academic-structure/classes/dto/create-class.dto';
import { MutateMappingDto } from 'src/modules/academic-coordinator/mapping/dto/mutate-mapping.dto';
import { MasterDataApprovalService } from './master-data-approval.service';
import { DecideRequestDto } from './dto/decide-request.dto';

/**
 * /api/v1/approval-requests/* — the "submit for review" alternative to each
 * entity's own direct-create endpoint (Admin for Departments/Courses/
 * Batches/Classes, Academic Coordinator for curriculum-mapping), plus the
 * review surface Principal (master data) and HOD (curriculum-mapping, own
 * department only) use to decide them. Kept as one controller, separate
 * from DepartmentsController/CoursesController/etc., specifically so those
 * existing controllers/modules need zero changes — this whole feature is
 * additive.
 */
@Controller('approval-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MasterDataApprovalController {
  constructor(private readonly service: MasterDataApprovalService) {}

  @Post('departments')
  @Roles(ROLES.ADMIN)
  submitDepartment(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.submit(
      'department',
      'create',
      dto as unknown as Record<string, unknown>,
      user.sub,
      null,
    );
  }

  @Post('courses')
  @Roles(ROLES.ADMIN)
  submitCourse(
    @Body() dto: CreateCourseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.submit(
      'course',
      'create',
      dto as unknown as Record<string, unknown>,
      user.sub,
      null,
    );
  }

  @Post('batches')
  @Roles(ROLES.ADMIN)
  submitBatch(@Body() dto: CreateBatchDto, @CurrentUser() user: JwtPayload) {
    return this.service.submit(
      'batch',
      'create',
      dto as unknown as Record<string, unknown>,
      user.sub,
      null,
    );
  }

  @Post('classes')
  @Roles(ROLES.ADMIN)
  submitClass(@Body() dto: CreateClassDto, @CurrentUser() user: JwtPayload) {
    return this.service.submit(
      'class',
      'create',
      dto as unknown as Record<string, unknown>,
      user.sub,
      null,
    );
  }

  @Post('curriculum-mapping/add')
  @Roles(ROLES.ACADEMIC_COORDINATOR)
  submitAddMapping(
    @Body() dto: MutateMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.submit(
      'curriculum_mapping',
      'add_mapping',
      dto as unknown as Record<string, unknown>,
      user.sub,
      dto.department_id,
    );
  }

  @Post('curriculum-mapping/remove')
  @Roles(ROLES.ACADEMIC_COORDINATOR)
  submitRemoveMapping(
    @Body() dto: MutateMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.submit(
      'curriculum_mapping',
      'remove_mapping',
      dto as unknown as Record<string, unknown>,
      user.sub,
      dto.department_id,
    );
  }

  @Get()
  @Roles(ROLES.PRINCIPAL, ROLES.HOD)
  list(@CurrentUser() user: JwtPayload) {
    return this.service.listPending(user);
  }

  @Post(':id/approve')
  @Roles(ROLES.PRINCIPAL, ROLES.HOD)
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @Roles(ROLES.PRINCIPAL, ROLES.HOD)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reject(id, user, dto.reason);
  }
}
