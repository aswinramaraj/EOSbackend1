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
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FeePaymentService } from './fee-payment.service';
import { CreateFeePaymentDto } from './dto/create-fee-payment.dto';
import { UpdateFeePaymentDto } from './dto/update-fee-payment.dto';

@Controller()
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeePaymentController {
  constructor(private readonly feePaymentService: FeePaymentService) {}

  /**
   * GET /api/v1/fee-payments
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get('fee-payments')
  findAll() {
    return this.feePaymentService.findAll();
  }

  /**
   * GET /api/v1/fee-payments/dashboard
   *
   * One row per student fee demand mapping, with the payment status
   * rolled up for the Fee Payments dashboard.
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get('fee-payments/dashboard')
  dashboard() {
    return this.feePaymentService.dashboard();
  }

  /**
   * GET /api/v1/fee-payments/students/:studentId/workspace
   *
   * Error responses:
   *  401 UNAUTHORIZED     – missing/invalid access token
   *  403 FORBIDDEN        – authenticated user is not an admin
   *  404 STUDENT_NOT_FOUND – no student with the given id
   *  500 INTERNAL_ERROR   – unexpected server failure
   */
  @Get('fee-payments/students/:studentId/workspace')
  getStudentWorkspace(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.feePaymentService.getStudentWorkspace(studentId);
  }

  /**
   * GET /api/v1/fee-payments/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED          – missing/invalid access token
   *  403 FORBIDDEN             – authenticated user is not an admin
   *  404 FEE_PAYMENT_NOT_FOUND – no payment with the given id
   *  500 INTERNAL_ERROR        – unexpected server failure
   */
  @Get('fee-payments/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.feePaymentService.findOne(id);
  }

  /**
   * GET /api/v1/student-fee-demand-mappings/:id/payments
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Get('student-fee-demand-mappings/:id/payments')
  findAllForDemandMapping(@Param('id', ParseIntPipe) id: number) {
    return this.feePaymentService.findAllForDemandMapping(id);
  }

  /**
   * POST /api/v1/student-fee-demand-mappings/:id/payments
   *
   * Error responses:
   *  400 VALIDATION_ERROR              – missing/invalid fields
   *  401 UNAUTHORIZED                  – missing/invalid access token
   *  403 FORBIDDEN                     – authenticated user is not an admin
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND  – no demand mapping with the given id
   *  404 USER_NOT_FOUND                – collected_by_user_id does not exist
   *  409 FEE_PAYMENT_RECEIPT_EXISTS    – receipt_no already used by another payment
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT    – amount_paid would exceed the demand's total_amount
   *  500 INTERNAL_ERROR                – unexpected server failure
   */
  @Post('student-fee-demand-mappings/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeePaymentDto,
  ) {
    return this.feePaymentService.create(id, dto);
  }

  /**
   * PUT /api/v1/fee-payments/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR             – invalid fields
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  403 FORBIDDEN                    – authenticated user is not an admin
   *  404 FEE_PAYMENT_NOT_FOUND        – no payment with the given id
   *  404 USER_NOT_FOUND               – collected_by_user_id does not exist
   *  409 FEE_PAYMENT_RECEIPT_EXISTS   – receipt_no already used by another payment
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT   – amount_paid would exceed the demand's total_amount
   *  500 INTERNAL_ERROR               – unexpected server failure
   */
  @Put('fee-payments/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeePaymentDto,
  ) {
    return this.feePaymentService.update(id, dto);
  }

  /**
   * PATCH /api/v1/fee-payments/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/fee-payments/:id
   */
  @Patch('fee-payments/:id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeePaymentDto,
  ) {
    return this.feePaymentService.update(id, dto);
  }

  /**
   * DELETE /api/v1/fee-payments/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED          – missing/invalid access token
   *  403 FORBIDDEN             – authenticated user is not an admin
   *  404 FEE_PAYMENT_NOT_FOUND – no payment with the given id
   *  500 INTERNAL_ERROR        – unexpected server failure
   */
  @Delete('fee-payments/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.feePaymentService.remove(id);
  }
}
