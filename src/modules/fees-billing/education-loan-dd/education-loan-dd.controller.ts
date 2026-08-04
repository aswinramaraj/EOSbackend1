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
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { EducationLoanDdService } from './education-loan-dd.service';
import { CreateEducationLoanDdDto } from './dto/create-education-loan-dd.dto';
import { UpdateEducationLoanDdDto } from './dto/update-education-loan-dd.dto';

@Controller()
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class EducationLoanDdController {
  constructor(
    private readonly educationLoanDdService: EducationLoanDdService,
  ) {}

  /**
   * GET /api/v1/education-loan-dds
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get('education-loan-dds')
  findAll() {
    return this.educationLoanDdService.findAll();
  }

  /**
   * GET /api/v1/education-loan-dds/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                – missing/invalid access token
   *  403 FORBIDDEN                   – authenticated user is not an admin
   *  404 EDUCATION_LOAN_DD_NOT_FOUND – no DD with the given id
   *  500 INTERNAL_ERROR              – unexpected server failure
   */
  @Get('education-loan-dds/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.educationLoanDdService.findOne(id);
  }

  /**
   * GET /api/v1/student-fee-demand-mappings/:id/education-loan-dds
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Get('student-fee-demand-mappings/:id/education-loan-dds')
  findAllForDemandMapping(@Param('id', ParseIntPipe) id: number) {
    return this.educationLoanDdService.findAllForDemandMapping(id);
  }

  /**
   * POST /api/v1/student-fee-demand-mappings/:id/education-loan-dds
   *
   * Error responses:
   *  400 VALIDATION_ERROR                    – missing/invalid fields
   *  401 UNAUTHORIZED                        – missing/invalid access token
   *  403 FORBIDDEN                           – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND         – no demand mapping with the given id
   *  404 USER_NOT_FOUND                       – received_by_user_id does not exist
   *  409 EDUCATION_LOAN_DD_REFERENCE_EXISTS   – dd_reference_number already used by another DD
   *  422 DD_AMOUNT_EXCEEDS_DUE_AMOUNT         – amount would exceed the demand's total_amount
   *  500 INTERNAL_ERROR                       – unexpected server failure
   */
  @Post('student-fee-demand-mappings/:id/education-loan-dds')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEducationLoanDdDto,
  ) {
    return this.educationLoanDdService.create(id, dto);
  }

  /**
   * PUT /api/v1/education-loan-dds/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR                    – invalid fields
   *  401 UNAUTHORIZED                        – missing/invalid access token
   *  403 FORBIDDEN                           – authenticated user is not an admin
   *  404 EDUCATION_LOAN_DD_NOT_FOUND          – no DD with the given id
   *  404 USER_NOT_FOUND                       – received_by_user_id does not exist
   *  409 EDUCATION_LOAN_DD_REFERENCE_EXISTS   – dd_reference_number already used by another DD
   *  422 DD_AMOUNT_EXCEEDS_DUE_AMOUNT         – amount would exceed the demand's total_amount
   *  500 INTERNAL_ERROR                       – unexpected server failure
   */
  @Put('education-loan-dds/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEducationLoanDdDto,
  ) {
    return this.educationLoanDdService.update(id, dto);
  }

  /**
   * PATCH /api/v1/education-loan-dds/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/education-loan-dds/:id
   */
  @Patch('education-loan-dds/:id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEducationLoanDdDto,
  ) {
    return this.educationLoanDdService.update(id, dto);
  }

  /**
   * DELETE /api/v1/education-loan-dds/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                – missing/invalid access token
   *  403 FORBIDDEN                   – authenticated user is not an admin
   *  404 EDUCATION_LOAN_DD_NOT_FOUND – no DD with the given id
   *  500 INTERNAL_ERROR              – unexpected server failure
   */
  @Delete('education-loan-dds/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.educationLoanDdService.remove(id);
  }
}
