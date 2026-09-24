import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenExpensesService } from './canteen-expenses.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateExpenseProductDto } from './dto/create-expense-product.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';

@Controller('canteen-admin/expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenExpensesController {
  constructor(private readonly expenses: CanteenExpensesService) {}

  @Get('categories')
  listCategories() {
    return this.expenses.listCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.expenses.createCategory(dto);
  }

  @Get('products')
  listProducts() {
    return this.expenses.listProducts();
  }

  @Post('products')
  createProduct(@Body() dto: CreateExpenseProductDto) {
    return this.expenses.createProduct(dto);
  }

  @Get()
  list(@Query() query: ListExpensesQueryDto) {
    return this.expenses.list(query);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }
}
