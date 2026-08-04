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
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

@Controller('purchase-orders')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  /**
   * POST /api/v1/purchase-orders
   *
   * Error responses:
   *  400 VALIDATION_ERROR                  – missing/invalid fields
   *  401 UNAUTHORIZED                      – missing/invalid access token
   *  403 FORBIDDEN                         – authenticated user is not an admin
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – proposal_id does not exist
   *  404 USER_NOT_FOUND                    – approved_by_user_id does not exist
   *  409 PURCHASE_ORDER_PROPOSAL_IN_USE    – proposal_id is already used by another purchase order
   *  409 PURCHASE_ORDER_NUMBER_EXISTS      – po_number already used by another purchase order
   *  500 INTERNAL_ERROR                    – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrdersService.create(dto);
  }

  /**
   * GET /api/v1/purchase-orders
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.purchaseOrdersService.findAll();
  }

  /**
   * GET /api/v1/purchase-orders/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 PURCHASE_ORDER_NOT_FOUND – no purchase order with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseOrdersService.findOne(id);
  }

  /**
   * PUT /api/v1/purchase-orders/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR                  – invalid fields
   *  401 UNAUTHORIZED                      – missing/invalid access token
   *  403 FORBIDDEN                         – authenticated user is not an admin
   *  404 PURCHASE_ORDER_NOT_FOUND          – no purchase order with the given id
   *  404 PURCHASE_ORDER_PROPOSAL_NOT_FOUND – proposal_id does not exist
   *  404 USER_NOT_FOUND                    – approved_by_user_id does not exist
   *  409 PURCHASE_ORDER_PROPOSAL_IN_USE    – proposal_id is already used by another purchase order
   *  409 PURCHASE_ORDER_NUMBER_EXISTS      – po_number already used by another purchase order
   *  500 INTERNAL_ERROR                    – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseOrdersService.update(id, dto);
  }

  /**
   * PATCH /api/v1/purchase-orders/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/purchase-orders/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseOrdersService.update(id, dto);
  }

  /**
   * DELETE /api/v1/purchase-orders/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 PURCHASE_ORDER_NOT_FOUND – no purchase order with the given id
   *  409 PURCHASE_ORDER_IN_USE    – purchase order is referenced by grn
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseOrdersService.remove(id);
  }
}
