import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { CanteenDishesService } from 'src/modules/canteen-admin/canteen-dishes.service';
import { CanteenOrderingService } from './canteen-ordering.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpayOrderDto } from './dto/verify-razorpay-order.dto';

/**
 * Every role gets canteen ordering except: Parent (no wallet at all, same
 * exclusion as WalletController's own WALLET_ROLES), Transport (explicitly
 * out of scope per the user), and the two canteen operational logins
 * (Admin/Cashier run the canteen, they aren't customers of it). Computed
 * from ROLES the same way WALLET_ROLES is, so a newly added role is
 * automatically included without this file needing to change too.
 */
const ORDERING_EXCLUDED_ROLES: string[] = [
  ROLES.PARENT,
  ROLES.TRANSPORT,
  ROLES.CANTEEN_ADMIN,
  ROLES.CANTEEN_CASHIER,
];
const ORDERING_ROLES = Object.values(ROLES).filter(
  (role) => !ORDERING_EXCLUDED_ROLES.includes(role),
);

@Controller('me/canteen-ordering')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ORDERING_ROLES)
export class CanteenOrderingController {
  constructor(
    private readonly ordering: CanteenOrderingService,
    private readonly dishes: CanteenDishesService,
  ) {}

  @Get('dishes')
  listDishes(
    @Query('category_id') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.dishes.listDishes(
      categoryId ? Number(categoryId) : undefined,
      search,
    );
  }

  @Get('dish-categories')
  listCategories() {
    return this.dishes.listCategories();
  }

  @Get('settings')
  getSettings() {
    return this.ordering.getSettings();
  }

  @Post('orders')
  placeOrder(@CurrentUser() user: JwtPayload, @Body() dto: PlaceOrderDto) {
    return this.ordering.placeOrder(user.sub, dto);
  }

  /** POST /me/canteen-ordering/checkout/razorpay-order — stages a Razorpay order. */
  @Post('checkout/razorpay-order')
  createRazorpayOrder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRazorpayOrderDto,
  ) {
    return this.ordering.createRazorpayOrder(user.sub, dto);
  }

  /** POST /me/canteen-ordering/checkout/razorpay-verify — server re-verifies the signature. */
  @Post('checkout/razorpay-verify')
  verifyRazorpayPayment(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyRazorpayOrderDto,
  ) {
    return this.ordering.verifyRazorpayPayment(user.sub, dto);
  }

  @Get('orders')
  listMyOrders(@CurrentUser() user: JwtPayload) {
    return this.ordering.listMyOrders(user.sub);
  }

  @Get('orders/:id')
  getOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordering.getOrder(user.sub, id);
  }

  @Post('orders/:id/cancel')
  cancelOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordering.cancelOrder(user.sub, id);
  }
}
