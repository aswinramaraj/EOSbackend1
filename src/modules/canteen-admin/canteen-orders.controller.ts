import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenOrdersService } from './canteen-orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

@Controller('canteen-admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenOrdersController {
  constructor(private readonly orders: CanteenOrdersService) {}

  @Get()
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }
}
