import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodEmployeeHrPayrollService } from './hod-employee-hr-payroll.service';
import { CreateHrPayrollRequestDto } from './dto/create-hr-payroll-request.dto';

@Controller('hod/employee/hr-payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeHrPayrollController {
  constructor(
    private readonly hodEmployeeHrPayrollService: HodEmployeeHrPayrollService,
  ) {}

  /** GET /api/v1/hod/employee/hr-payroll/requests */
  @Get('requests')
  getMyRequests(@CurrentUser() user: JwtPayload) {
    return this.hodEmployeeHrPayrollService.getMyRequests(user.sub);
  }

  /** POST /api/v1/hod/employee/hr-payroll/requests */
  @Post('requests')
  createRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHrPayrollRequestDto,
  ) {
    return this.hodEmployeeHrPayrollService.createRequest(user.sub, dto);
  }
}
