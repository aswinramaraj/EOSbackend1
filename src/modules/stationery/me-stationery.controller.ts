import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StationeryService } from './stationery.service';
import { CheckoutWalletDto } from './dto/checkout-wallet.dto';
import { CheckoutRazorpayOrderDto } from './dto/checkout-razorpay-order.dto';
import { VerifyRazorpayOrderDto } from './dto/verify-razorpay-order.dto';

/**
 * Self-service Stationery Store - open to every role ("for all login" per
 * the feature request), not just students. Only JwtAuthGuard, no RolesGuard/
 * @Roles - any authenticated account can browse and buy.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class MeStationeryController {
  constructor(private readonly stationeryService: StationeryService) {}

  /** GET /api/v1/stationery/products?category=&search= */
  @Get('stationery/products')
  listProducts(@Query('category') category?: string, @Query('search') search?: string) {
    return this.stationeryService.listProducts(category, search);
  }

  /** GET /api/v1/stationery/products/:id */
  @Get('stationery/products/:id')
  getProduct(@Param('id', ParseIntPipe) id: number) {
    return this.stationeryService.getProduct(id);
  }

  /** POST /api/v1/me/stationery/checkout/wallet */
  @Post('me/stationery/checkout/wallet')
  checkoutWithWallet(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutWalletDto) {
    return this.stationeryService.checkoutWithWallet(user.sub, dto);
  }

  /** POST /api/v1/me/stationery/checkout/razorpay-order */
  @Post('me/stationery/checkout/razorpay-order')
  createRazorpayOrder(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutRazorpayOrderDto) {
    return this.stationeryService.createRazorpayOrder(user.sub, dto);
  }

  /** POST /api/v1/me/stationery/checkout/razorpay-verify */
  @Post('me/stationery/checkout/razorpay-verify')
  verifyRazorpayPayment(@CurrentUser() user: JwtPayload, @Body() dto: VerifyRazorpayOrderDto) {
    return this.stationeryService.verifyRazorpayPayment(user.sub, dto);
  }

  /** GET /api/v1/me/stationery/orders */
  @Get('me/stationery/orders')
  listMyOrders(@CurrentUser() user: JwtPayload) {
    return this.stationeryService.listMyOrders(user.sub);
  }

  /** GET /api/v1/me/stationery/orders/:id */
  @Get('me/stationery/orders/:id')
  getMyOrder(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.stationeryService.getMyOrder(user.sub, id);
  }
}
