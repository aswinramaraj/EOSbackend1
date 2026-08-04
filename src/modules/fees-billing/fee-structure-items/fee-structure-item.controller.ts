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
import { FeeStructureItemService } from './fee-structure-item.service';
import { CreateFeeStructureItemDto } from './dto/create-fee-structure-item.dto';
import { UpdateFeeStructureItemDto } from './dto/update-fee-structure-item.dto';

@Controller()
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeeStructureItemController {
  constructor(
    private readonly feeStructureItemService: FeeStructureItemService,
  ) {}

  /**
   * GET /api/v1/fee-structure-items
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get('fee-structure-items')
  findAll() {
    return this.feeStructureItemService.findAll();
  }

  /**
   * GET /api/v1/fee-structure-items/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND – no item with the given id
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Get('fee-structure-items/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.feeStructureItemService.findOne(id);
  }

  /**
   * GET /api/v1/fee-structures/:id/items
   *
   * Error responses:
   *  401 UNAUTHORIZED            – missing/invalid access token
   *  403 FORBIDDEN               – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   *  500 INTERNAL_ERROR          – unexpected server failure
   */
  @Get('fee-structures/:id/items')
  findAllForFeeStructure(@Param('id', ParseIntPipe) id: number) {
    return this.feeStructureItemService.findAllForFeeStructure(id);
  }

  /**
   * POST /api/v1/fee-structures/:id/items
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – missing/invalid fields
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND    – no fee structure with the given id
   *  404 DEMAND_CATEGORY_NOT_FOUND  – demand_category_id does not exist
   *  409 FEE_STRUCTURE_ITEM_EXISTS  – this fee structure already has an item for this demand category
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Post('fee-structures/:id/items')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeeStructureItemDto,
  ) {
    return this.feeStructureItemService.create(id, dto);
  }

  /**
   * PUT /api/v1/fee-structure-items/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR             – invalid fields
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND – no item with the given id
   *  404 DEMAND_CATEGORY_NOT_FOUND    – demand_category_id does not exist
   *  409 FEE_STRUCTURE_ITEM_EXISTS    – this fee structure already has an item for this demand category
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Put('fee-structure-items/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeeStructureItemDto,
  ) {
    return this.feeStructureItemService.update(id, dto);
  }

  /**
   * PATCH /api/v1/fee-structure-items/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/fee-structure-items/:id
   */
  @Patch('fee-structure-items/:id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeeStructureItemDto,
  ) {
    return this.feeStructureItemService.update(id, dto);
  }

  /**
   * DELETE /api/v1/fee-structure-items/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND – no item with the given id
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Delete('fee-structure-items/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.feeStructureItemService.remove(id);
  }
}
