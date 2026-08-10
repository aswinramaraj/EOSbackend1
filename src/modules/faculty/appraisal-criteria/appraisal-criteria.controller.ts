import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AppraisalCriteriaService } from './appraisal-criteria.service';
import { CreateAppraisalDivisionDto } from './dto/create-appraisal-division.dto';
import { CreateAppraisalCriteriaDto } from './dto/create-appraisal-criteria.dto';
import { UpdateAppraisalCriteriaDto } from './dto/update-appraisal-criteria.dto';
import { ListAppraisalCriteriaQueryDto } from './dto/list-appraisal-criteria-query.dto';

/**
 * Criteria Library — no class-level prefix since this controller serves two
 * top-level resources (appraisal-divisions, appraisal-criteria), same trick
 * as HolidaySlotsController.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppraisalCriteriaController {
  constructor(
    private readonly appraisalCriteriaService: AppraisalCriteriaService,
  ) {}

  /** POST /api/v1/appraisal-divisions — Admin/HR Payroll only. */
  @Post('appraisal-divisions')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  @HttpCode(HttpStatus.CREATED)
  createDivision(@Body() dto: CreateAppraisalDivisionDto) {
    return this.appraisalCriteriaService.createDivision(dto);
  }

  /** GET /api/v1/appraisal-divisions — Admin/HoD/HR Payroll/Faculty (read-only catalog). */
  @Get('appraisal-divisions')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.FACULTY)
  findAllDivisions() {
    return this.appraisalCriteriaService.findAllDivisions();
  }

  /** DELETE /api/v1/appraisal-divisions/:id — Admin/HR Payroll only. Blocked if criteria reference it. */
  @Delete('appraisal-divisions/:id')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  removeDivision(@Param('id', ParseIntPipe) id: number) {
    return this.appraisalCriteriaService.removeDivision(id);
  }

  /** POST /api/v1/appraisal-criteria — Admin/HR Payroll only. */
  @Post('appraisal-criteria')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAppraisalCriteriaDto) {
    return this.appraisalCriteriaService.create(dto);
  }

  /** GET /api/v1/appraisal-criteria — Admin/HoD/HR Payroll/Faculty (read-only catalog). Paginated, filterable. */
  @Get('appraisal-criteria')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.FACULTY)
  findAll(@Query() query: ListAppraisalCriteriaQueryDto) {
    return this.appraisalCriteriaService.findAll(query);
  }

  /** GET /api/v1/appraisal-criteria/:id — Admin/HoD/HR Payroll/Faculty. */
  @Get('appraisal-criteria/:id')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.FACULTY)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.appraisalCriteriaService.findOne(id);
  }

  /** PATCH /api/v1/appraisal-criteria/:id — Admin/HR Payroll only. */
  @Patch('appraisal-criteria/:id')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAppraisalCriteriaDto,
  ) {
    return this.appraisalCriteriaService.update(id, dto);
  }

  /** DELETE /api/v1/appraisal-criteria/:id — Admin/HR Payroll only. Blocked if entries reference it. */
  @Delete('appraisal-criteria/:id')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.appraisalCriteriaService.remove(id);
  }
}
