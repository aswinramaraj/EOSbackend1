import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { StationeryService } from './stationery.service';
import { CreateStationeryProductDto } from './dto/create-stationery-product.dto';
import { UpdateStationeryProductDto } from './dto/update-stationery-product.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/**
 * Counter-staff/admin side of the Stationery Store. Uses its OWN role
 * (STATIONERY) - deliberately separate from the print-shop's STATIONARY
 * role/login (explicit product decision: they are not the same counter or
 * staff, and must not share a login). ADMIN can also manage it, same as
 * every other role-gated admin surface in this backend.
 */
@Controller('stationery/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STATIONERY, ROLES.ADMIN)
export class StationeryAdminController {
  constructor(private readonly stationeryService: StationeryService) {}

  /** GET /api/v1/stationery/admin/dashboard */
  @Get('dashboard')
  getDashboard() {
    return this.stationeryService.getDashboard();
  }

  /** GET /api/v1/stationery/admin/reports - all-time totals (no range filter). */
  @Get('reports')
  getReports() {
    return this.stationeryService.getReports('all');
  }

  /** GET /api/v1/stationery/admin/products - includes inactive products. */
  @Get('products')
  listAllProducts() {
    return this.stationeryService.listAllProducts();
  }

  /** POST /api/v1/stationery/admin/products */
  @Post('products')
  createProduct(@CurrentUser() user: JwtPayload, @Body() dto: CreateStationeryProductDto) {
    return this.stationeryService.createProduct(user.sub, dto);
  }

  /**
   * POST /api/v1/stationery/admin/products/image-upload (multipart, field
   * "file") - standalone, no product id required (the Add-product form has
   * no id yet). Returns { image_url }; the caller passes that straight into
   * create/update's own image_url field.
   */
  @Post('products/image-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadProductImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.stationeryService.uploadProductImage(file);
  }

  /** PATCH /api/v1/stationery/admin/products/:id */
  @Patch('products/:id')
  updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStationeryProductDto) {
    return this.stationeryService.updateProduct(id, dto);
  }

  /** DELETE /api/v1/stationery/admin/products/:id - soft delete (is_active=false). */
  @Delete('products/:id')
  deactivateProduct(@Param('id', ParseIntPipe) id: number) {
    return this.stationeryService.deactivateProduct(id);
  }

  /** GET /api/v1/stationery/admin/orders?status= */
  @Get('orders')
  listAllOrders(@Query('status') status?: string) {
    return this.stationeryService.listAllOrders(status);
  }

  /** GET /api/v1/stationery/admin/orders/:id */
  @Get('orders/:id')
  getOrder(@Param('id', ParseIntPipe) id: number) {
    return this.stationeryService.getOrderForAdmin(id);
  }

  /** PATCH /api/v1/stationery/admin/orders/:id/status */
  @Patch('orders/:id/status')
  updateOrderStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusDto) {
    return this.stationeryService.updateOrderStatus(id, dto);
  }
}
