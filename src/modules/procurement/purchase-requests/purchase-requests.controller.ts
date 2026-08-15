import {
  Body,
  Controller,
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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PurchaseRequestsService } from './purchase-requests.service';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { ListPurchaseRequestsQueryDto } from './dto/list-purchase-requests-query.dto';
import { HodReviewPurchaseRequestDto } from './dto/hod-review-purchase-request.dto';
import { FinanceReviewPurchaseRequestDto } from './dto/finance-review-purchase-request.dto';

/**
 * Self-service workflow: Secretary creates -> HoD reviews -> Finance
 * reviews -> Admin converts to a purchase_orders record. Backed by the
 * existing purchase_indents/purchase_order_proposals/purchase_orders
 * tables (see PurchaseRequestsService for why this is a separate layer
 * from the pre-existing Admin-only /purchase-indents etc. endpoints).
 */
@Controller('me/purchase-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequestsService: PurchaseRequestsService) {}

  /**
   * POST /api/v1/me/purchase-requests — Secretary only.
   *
   * Error responses:
   *  400 VALIDATION_ERROR     – missing/invalid fields
   *  401 UNAUTHORIZED         – missing/invalid access token
   *  403 FORBIDDEN            – authenticated but not a Secretary
   *  404 DEPARTMENT_NOT_FOUND – department_id does not exist
   *  500 INTERNAL_ERROR       – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.SECRETARY)
  create(@Body() dto: CreatePurchaseRequestDto, @CurrentUser() user: JwtPayload) {
    return this.purchaseRequestsService.create(dto, user.sub);
  }

  /** GET /api/v1/me/purchase-requests — Secretary (own)/HoD (own dept)/Finance/Admin (institution-wide). */
  @Get()
  @Roles(ROLES.SECRETARY, ROLES.HOD, ROLES.FINANCE, ROLES.ADMIN)
  findAll(@Query() query: ListPurchaseRequestsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.purchaseRequestsService.findAll(query, user);
  }

  /** GET /api/v1/me/purchase-requests/:id — same scoping as the list endpoint. */
  @Get(':id')
  @Roles(ROLES.SECRETARY, ROLES.HOD, ROLES.FINANCE, ROLES.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.purchaseRequestsService.findOne(id, user);
  }

  /**
   * PATCH /api/v1/me/purchase-requests/:id/hod-review — HoD only, own
   * department, only while awaiting HoD review.
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – missing/invalid decision
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated but not a HoD
   *  403 NOT_YOUR_DEPARTMENT       – request belongs to a different department
   *  404 PURCHASE_REQUEST_NOT_FOUND – no request with the given id
   *  422 INVALID_WORKFLOW_STATE    – request is not awaiting HoD review
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Patch(':id/hod-review')
  @Roles(ROLES.HOD)
  hodReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HodReviewPurchaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.hodReview(id, dto, user);
  }

  /** PATCH /api/v1/me/purchase-requests/:id/finance-review — Finance only, only while awaiting Finance review. */
  @Patch(':id/finance-review')
  @Roles(ROLES.FINANCE)
  financeReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinanceReviewPurchaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.financeReview(id, dto, user.sub);
  }

  /** PATCH /api/v1/me/purchase-requests/:id/convert — Admin only, only once Finance-approved. No request body. */
  @Patch(':id/convert')
  @Roles(ROLES.ADMIN)
  convert(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.purchaseRequestsService.convert(id, user.sub);
  }
}
