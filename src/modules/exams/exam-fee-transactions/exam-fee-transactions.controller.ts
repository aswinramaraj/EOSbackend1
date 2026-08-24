import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { ExamFeeTransactionsService } from './exam-fee-transactions.service';
import { ListExamFeeTransactionsQueryDto } from './dto/list-exam-fee-transactions-query.dto';
import { CreateExamFeeTransactionDto } from './dto/create-exam-fee-transaction.dto';
import { UpdateExamFeeStatusDto } from './dto/update-exam-fee-status.dto';

@Controller('exam-fee-transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamFeeTransactionsController {
  constructor(private readonly service: ExamFeeTransactionsService) {}

  @Get('stats')
  async getStats() {
    const stats = await this.service.getStats();
    return ApiResponse.ok(stats, 'Exam fee stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListExamFeeTransactionsQueryDto) {
    const rows = await this.service.findAll(query);
    return ApiResponse.ok(rows, 'Exam fee transactions fetched successfully.');
  }

  @Post()
  async create(@Body() dto: CreateExamFeeTransactionDto) {
    const row = await this.service.create(dto);
    return ApiResponse.created(row, 'Exam fee transaction recorded successfully.');
  }

  @Patch(':id/status')
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExamFeeStatusDto) {
    const row = await this.service.updateStatus(id, dto);
    return ApiResponse.ok(row, 'Exam fee transaction status updated successfully.');
  }
}
