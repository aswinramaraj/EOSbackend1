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
import { UpdateOwnPayslipDto } from './dto/update-own-payslip.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayslipRequestsController {
  constructor(
    private readonly payslipRequestsService: PayslipRequestsService,
  ) {}

  /** POST /api/v1/payslip-requests — Faculty or HoD, for the caller's own record. */
  @Post('payslip-requests')
  @Roles(
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.SECRETARY,
    // Non-teaching staff raise their own requests through the same route;
    // the service branches on whether a faculty row exists, not on role.
    ROLES.HR_PAYROLL,
    ROLES.WARDEN,
  )
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreatePayslipRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.create(dto, user.sub);
  }

  /** GET /api/v1/payslip-requests — HR Payroll (all) / Faculty/HoD/Secretary (own only). */
  @Get('payslip-requests')
  @Roles(ROLES.HR_PAYROLL, ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  findAll(
    @Query() query: ListPayslipRequestQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.findAll(query, user);
  }

  /** GET /api/v1/payslip-requests/:id — HR Payroll (all) / Faculty/HoD/Secretary (own only). */
  @Get('payslip-requests/:id')
  @Roles(ROLES.HR_PAYROLL, ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
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

  /** PATCH /api/v1/me/my-payslip-requests/:id — self-edit, purpose only, own request, while still 'pending'. */
  @Patch('my-payslip-requests/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  updateOwn(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOwnPayslipDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.updateOwnPurpose(
      id,
      user.sub,
      user.role,
      dto.purpose,
    );
  }

  /** DELETE /api/v1/payslip-requests/:id — Faculty, HoD or Secretary, own request, only while still 'pending'. */
  @Delete('payslip-requests/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payslipRequestsService.remove(id, user.sub, user.role);
  }
}
