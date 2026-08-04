import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { DemandService } from './demand.service';
import { CreateDemandCategoryDto } from './dto/create-demand-category.dto';
import { UpdateDemandCategoryDto } from './dto/update-demand-category.dto';

@Controller('demand-categories')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class DemandController {
  constructor(private readonly demandService: DemandService) {}

  /**
   * POST /api/v1/demand-categories
   *
   * Error responses:
   *  400 VALIDATION_ERROR       – missing/invalid name
   *  401 UNAUTHORIZED           – missing/invalid access token
   *  403 FORBIDDEN              – authenticated user is not an admin
   *  409 DEMAND_CATEGORY_EXISTS – a demand category with the same name already exists
   *  500 INTERNAL_ERROR         – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDemandCategoryDto) {
    return this.demandService.create(dto);
  }

  /**
   * GET /api/v1/demand-categories
   *
   * Error responses:
   *  401 UNAUTHORIZED – missing/invalid access token
   *  403 FORBIDDEN    – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.demandService.findAll();
  }

  /**
   * GET /api/v1/demand-categories/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.demandService.findOne(id);
  }

  /**
   * PUT /api/v1/demand-categories/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – invalid name
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   *  409 DEMAND_CATEGORY_EXISTS    – another category already uses this name
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDemandCategoryDto,
  ) {
    return this.demandService.update(id, dto);
  }

  /**
   * DELETE /api/v1/demand-categories/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 DEMAND_CATEGORY_NOT_FOUND – no category with the given id
   *  409 DEMAND_CATEGORY_IN_USE    – category is referenced by fee_structure_items
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.demandService.remove(id);
  }
}
