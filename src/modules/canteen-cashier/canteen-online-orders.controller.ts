import {
  Body,
  Controller,
  Get,
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
import { CanteenOnlineOrdersService } from './canteen-online-orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('canteen-cashier/online-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_CASHIER)
export class CanteenOnlineOrdersController {
  constructor(private readonly onlineOrders: CanteenOnlineOrdersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.onlineOrders.list(status);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.onlineOrders.updateStatus(id, dto);
  }

  @Post(':id/generate-bill')
  generateBill(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.onlineOrders.generateBill(id, user.sub);
  }
}
