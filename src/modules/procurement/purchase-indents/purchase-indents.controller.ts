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
import { PurchaseIndentsService } from './purchase-indents.service';
import { CreatePurchaseIndentDto } from './dto/create-purchase-indent.dto';
import { UpdatePurchaseIndentDto } from './dto/update-purchase-indent.dto';

@Controller('purchase-indents')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseIndentsController {
  constructor(
    private readonly purchaseIndentsService: PurchaseIndentsService,
  ) {}

  /**
   * POST /api/v1/purchase-indents
   *
   * Error responses:
   *  400 VALIDATION_ERROR     – missing/invalid fields
   *  401 UNAUTHORIZED         – missing/invalid access token
   *  403 FORBIDDEN            – authenticated user is not an admin
   *  404 USER_NOT_FOUND       – requested_by_user_id does not exist
   *  404 DEPARTMENT_NOT_FOUND – department_id does not exist
   *  500 INTERNAL_ERROR       – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePurchaseIndentDto) {
    return this.purchaseIndentsService.create(dto);
  }

  /**
   * GET /api/v1/purchase-indents
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.purchaseIndentsService.findAll();
  }

  /**
   * GET /api/v1/purchase-indents/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 PURCHASE_INDENT_NOT_FOUND – no indent with the given id
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseIndentsService.findOne(id);
  }

  /**
   * PUT /api/v1/purchase-indents/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – invalid fields
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 PURCHASE_INDENT_NOT_FOUND – no indent with the given id
   *  404 USER_NOT_FOUND            – requested_by_user_id does not exist
   *  404 DEPARTMENT_NOT_FOUND      – department_id does not exist
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseIndentDto,
  ) {
    return this.purchaseIndentsService.update(id, dto);
  }

  /**
   * PATCH /api/v1/purchase-indents/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/purchase-indents/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseIndentDto,
  ) {
    return this.purchaseIndentsService.update(id, dto);
  }

  /**
   * DELETE /api/v1/purchase-indents/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 PURCHASE_INDENT_NOT_FOUND – no indent with the given id
   *  409 PURCHASE_INDENT_IN_USE    – indent is referenced by purchase_order_proposals
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseIndentsService.remove(id);
  }
}
