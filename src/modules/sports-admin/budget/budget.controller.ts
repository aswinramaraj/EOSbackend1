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
import { BudgetService } from './budget.service';
import { CreateBudgetRequestDto } from './dto/create-budget-request.dto';
import { SearchBudgetRequestsDto } from './dto/search-budget-requests.dto';

@Controller('sports-admin/budget-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get()
  findAll(@Query() query: SearchBudgetRequestsDto) {
    return this.budgetService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateBudgetRequestDto, @CurrentUser() user: JwtPayload) {
    return this.budgetService.create(dto, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.budgetService.findOne(id);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.budgetService.approve(id, user.sub);
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.budgetService.reject(id, user.sub);
  }
}
