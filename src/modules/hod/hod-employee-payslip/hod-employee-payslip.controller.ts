import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreatePayslipRequestDto } from 'src/modules/faculty/payslip-requests/dto/create-payslip-request.dto';
import { HodEmployeePayslipService } from './hod-employee-payslip.service';

@Controller('hod/employee/payslip')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeePayslipController {
  constructor(
    private readonly hodEmployeePayslipService: HodEmployeePayslipService,
  ) {}

  /** GET /api/v1/hod/employee/payslip/history */
  @Get('history')
  getHistory(@CurrentUser() user: JwtPayload) {
    return this.hodEmployeePayslipService.getHistory(user.sub);
  }

  /** POST /api/v1/hod/employee/payslip */
  @Post()
  apply(@CurrentUser() user: JwtPayload, @Body() dto: CreatePayslipRequestDto) {
    return this.hodEmployeePayslipService.apply(user.sub, dto);
  }
}
