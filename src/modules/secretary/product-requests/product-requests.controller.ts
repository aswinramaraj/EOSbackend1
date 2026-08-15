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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ProductRequestsService } from './product-requests.service';
import { CreateProductRequestDto } from './dto/create-product-request.dto';
import { UpdateProductRequestDto } from './dto/update-product-request.dto';
import { ListProductRequestQueryDto } from './dto/list-product-request-query.dto';
import { ReviewProductRequestDto } from './dto/review-product-request.dto';

/**
 * Product Order Proposal (POP) self-service requests — Secretary Portal.
 * Deliberately separate from procurement/purchase-indents: that module is an
 * Admin-only, single-item, vendor/Finance/HoD pipeline; this is a
 * self-service, multi-item, single-decision request with no vendor concept.
 * See the schema/impact-analysis discussion for why these aren't merged.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductRequestsController {
  constructor(
    private readonly productRequestsService: ProductRequestsService,
  ) {}

  /** POST /api/v1/me/product-requests — Secretary. */
  @Post('product-requests')
  @Roles(ROLES.SECRETARY)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateProductRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.create(dto, user.sub);
  }

  /** GET /api/v1/me/product-requests — Secretary (own only) / Admin (all). */
  @Get('product-requests')
  @Roles(ROLES.SECRETARY, ROLES.ADMIN)
  findAll(
    @Query() query: ListProductRequestQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.findAll(query, user);
  }

  /** GET /api/v1/me/product-requests/:id — Secretary (own only) / Admin (any). */
  @Get('product-requests/:id')
  @Roles(ROLES.SECRETARY, ROLES.ADMIN)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.findOne(id, user);
  }

  /** PATCH /api/v1/me/product-requests/:id — Secretary, own request, only while 'draft'. */
  @Patch('product-requests/:id')
  @Roles(ROLES.SECRETARY)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.update(id, dto, user.sub);
  }

  /** POST /api/v1/me/product-requests/:id/submit — Secretary, own request, only while 'draft'. */
  @Post('product-requests/:id/submit')
  @Roles(ROLES.SECRETARY)
  submit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.submit(id, user.sub);
  }

  /** PATCH /api/v1/me/product-requests/:id/review — Admin only, only while 'pending'. */
  @Patch('product-requests/:id/review')
  @Roles(ROLES.ADMIN)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewProductRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.review(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/product-requests/:id — Secretary, own request, only while 'draft'. */
  @Delete('product-requests/:id')
  @Roles(ROLES.SECRETARY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productRequestsService.remove(id, user.sub);
  }
}
