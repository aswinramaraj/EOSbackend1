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
import { StudentFeeDemandMappingService } from './student-fee-demand-mapping.service';
import { CreateStudentFeeDemandMappingDto } from './dto/create-student-fee-demand-mapping.dto';
import { UpdateStudentFeeDemandMappingDto } from './dto/update-student-fee-demand-mapping.dto';

@Controller('student-fee-demand-mappings')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentFeeDemandMappingController {
  constructor(
    private readonly studentFeeDemandMappingService: StudentFeeDemandMappingService,
  ) {}

  /**
   * POST /api/v1/student-fee-demand-mappings
   *
   * Error responses:
   *  400 VALIDATION_ERROR                   – missing/invalid fields
   *  401 UNAUTHORIZED                       – missing/invalid access token
   *  403 FORBIDDEN                          – authenticated user is not an admin
   *  404 STUDENT_NOT_FOUND                  – student_id does not exist
   *  404 FEE_STRUCTURE_NOT_FOUND            – fee_structure_id does not exist
   *  409 STUDENT_FEE_DEMAND_ALREADY_EXISTS  – a demand already exists for this student/structure/year/semester
   *  422 FEE_STRUCTURE_HAS_NO_ITEMS         – fee structure has no fee_structure_items
   *  500 INTERNAL_ERROR                     – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateStudentFeeDemandMappingDto) {
    return this.studentFeeDemandMappingService.create(dto);
  }

  /**
   * GET /api/v1/student-fee-demand-mappings
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.studentFeeDemandMappingService.findAll();
  }

  /**
   * GET /api/v1/student-fee-demand-mappings/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.studentFeeDemandMappingService.findOne(id);
  }

  /**
   * PUT /api/v1/student-fee-demand-mappings/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR             – invalid fields
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentFeeDemandMappingDto,
  ) {
    return this.studentFeeDemandMappingService.update(id, dto);
  }

  /**
   * PATCH /api/v1/student-fee-demand-mappings/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/student-fee-demand-mappings/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentFeeDemandMappingDto,
  ) {
    return this.studentFeeDemandMappingService.update(id, dto);
  }

  /**
   * DELETE /api/v1/student-fee-demand-mappings/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  409 STUDENT_FEE_DEMAND_IN_USE    – referenced by fee_payments or education_loan_dd
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.studentFeeDemandMappingService.remove(id);
  }
}
