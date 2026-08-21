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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
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
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(
    @Body() createFeeStructureDto: CreateFeeStructureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeStructureService.create(createFeeStructureDto, user.sub);
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
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  @UseGuards(JwtAuthGuard, RolesGuard)
  addConcession(
    @Param('id') id: string,
    @Body() addConcessionDto: AddConcessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeStructureService.addConcession(+id, addConcessionDto, user.sub);
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
  @Roles(ROLES.ADMIN, ROLES.BILLING)
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
  @Roles(ROLES.ADMIN, ROLES.BILLING)
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
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(
    @Param('id') id: string,
    @Body() updateFeeStructureDto: UpdateFeeStructureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeStructureService.update(+id, updateFeeStructureDto, user.sub);
  }

  /**
   * PATCH /api/v1/fee-structures/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one
   * method (a real bug found and fixed this session: PATCH was previously
   * 404ing since @Patch's metadata silently overwrote @Put's on the same
   * method).
   *
   * Error responses: see PUT /api/v1/fee-structures/:id
   */
  @Patch(':id')
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  @UseGuards(JwtAuthGuard, RolesGuard)
  patch(
    @Param('id') id: string,
    @Body() updateFeeStructureDto: UpdateFeeStructureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeStructureService.update(+id, updateFeeStructureDto, user.sub);
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
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  @UseGuards(JwtAuthGuard, RolesGuard)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.feeStructureService.remove(+id, user.sub);
  }
}
