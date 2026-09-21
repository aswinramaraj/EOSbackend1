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
import { CanteenBillingService } from './canteen-billing.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { ListBillsQueryDto } from './dto/list-bills-query.dto';

@Controller('canteen-cashier/bills')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_CASHIER)
export class CanteenBillingController {
  constructor(private readonly billing: CanteenBillingService) {}

  @Post()
  create(@Body() dto: CreateBillDto, @CurrentUser() user: JwtPayload) {
    return this.billing.createBill(dto, user.sub);
  }

  @Get()
  list(@Query() query: ListBillsQueryDto) {
    return this.billing.listBills(query);
  }

  @Patch(':id/void')
  void(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.billing.voidBill(id, user.sub);
  }
}
