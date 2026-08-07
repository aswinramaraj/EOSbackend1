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
import { PayslipRequestsService } from './payslip-requests.service';
import { CreatePayslipRequestDto } from './dto/create-payslip-request.dto';
import { UpdatePayslipRequestDto } from './dto/update-payslip-request.dto';
import { ListPayslipRequestQueryDto } from './dto/list-payslip-request-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayslipRequestsController {
  constructor(
    private readonly payslipRequestsService: PayslipRequestsService,
  ) {}

  /** POST /api/v1/payslip-requests — Faculty only. */
  @Post('payslip-requests')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreatePayslipRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.create(dto, user.sub);
  }

  /** GET /api/v1/payslip-requests — HR Payroll (all) / Faculty (own only). */
  @Get('payslip-requests')
  @Roles(ROLES.HR_PAYROLL, ROLES.FACULTY)
  findAll(
    @Query() query: ListPayslipRequestQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.findAll(query, user);
  }

  /** GET /api/v1/payslip-requests/:id — HR Payroll (all) / Faculty (own only). */
  @Get('payslip-requests/:id')
  @Roles(ROLES.HR_PAYROLL, ROLES.FACULTY)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.findOne(id, user);
  }

  /**
   * PATCH /api/v1/payslip-requests/:id — HR Payroll only. Marks the request
   * 'processed' or 'rejected' directly - no file upload involved.
   */
  @Patch('payslip-requests/:id')
  @Roles(ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePayslipRequestDto,
  ) {
    return this.payslipRequestsService.update(id, dto);
  }

  /** DELETE /api/v1/payslip-requests/:id — Faculty only, own request, only while still 'pending'. */
  @Delete('payslip-requests/:id')
  @Roles(ROLES.FACULTY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.remove(id, user.sub);
  }
}
