import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FeeStructureService } from './fee-structure.service';
import { AddConcessionDto } from './dto/add-concession.dto';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { UpdateFeeStructureDto } from './dto/update-fee-structure.dto';

@Controller('fee-structures')
export class FeeStructureController {
  constructor(private readonly feeStructureService: FeeStructureService) {}

  /**
   * POST /api/v1/fee-structures
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – DTO validation failure
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 QUOTA_NOT_FOUND            – quota_id does not exist
   *  404 DEMAND_CATEGORY_NOT_FOUND  – one or more demand_category_id do not exist
   *  422 DUPLICATE_DEMAND_CATEGORY  – same demand_category_id repeated in items
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() createFeeStructureDto: CreateFeeStructureDto) {
    return this.feeStructureService.create(createFeeStructureDto);
  }

  /**
   * POST /api/v1/fee-structures/:id/concessions
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – DTO validation failure
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND   – no fee structure with the given id
   *  422 CONCESSION_EXCEEDS_TOTAL  – concession_amount exceeds the total fee structure amount
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Post(':id/concessions')
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  addConcession(
    @Param('id') id: string,
    @Body() addConcessionDto: AddConcessionDto,
  ) {
    return this.feeStructureService.addConcession(+id, addConcessionDto);
  }

  /**
   * GET /api/v1/fee-structures
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN       – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  @Roles(ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAll() {
    return this.feeStructureService.findAll();
  }

  /**
   * GET /api/v1/fee-structures/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND  – no fee structure with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Get(':id')
  @Roles(ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findOne(@Param('id') id: string) {
    return this.feeStructureService.findOne(+id);
  }

  /**
   * PUT /api/v1/fee-structures/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR         – DTO validation failure
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND  – no fee structure with the given id
   *  404 QUOTA_NOT_FOUND          – quota_id does not exist
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Put(':id')
  @Patch(':id')
  @Roles(ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(
    @Param('id') id: string,
    @Body() updateFeeStructureDto: UpdateFeeStructureDto,
  ) {
    return this.feeStructureService.update(+id, updateFeeStructureDto);
  }

  /**
   * DELETE /api/v1/fee-structures/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND  – no fee structure with the given id
   *  409 FEE_STRUCTURE_IN_USE     – fee structure is referenced by student mappings
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Delete(':id')
  @Roles(ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  remove(@Param('id') id: string) {
    return this.feeStructureService.remove(+id);
  }
}
