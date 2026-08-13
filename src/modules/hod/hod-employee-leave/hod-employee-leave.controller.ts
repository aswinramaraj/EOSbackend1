import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateFacultyLeafDto } from 'src/modules/faculty/faculty-leaves/dto/create-faculty-leaf.dto';
import { HodEmployeeLeaveService } from './hod-employee-leave.service';

@Controller('hod/employee/leave')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeLeaveController {
  constructor(
    private readonly hodEmployeeLeaveService: HodEmployeeLeaveService,
  ) {}

  /** GET /api/v1/hod/employee/leave/types */
  @Get('types')
  getLeaveTypes() {
    return this.hodEmployeeLeaveService.getLeaveTypes();
  }

  /** GET /api/v1/hod/employee/leave/balances */
  @Get('balances')
  getBalances(@CurrentUser() user: JwtPayload) {
    return this.hodEmployeeLeaveService.getBalances(user.sub);
  }

  /** GET /api/v1/hod/employee/leave/history?status= */
  @Get('history')
  getHistory(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: 'pending' | 'approved' | 'rejected',
  ) {
    return this.hodEmployeeLeaveService.getHistory(user.sub, status);
  }

  /** POST /api/v1/hod/employee/leave */
  @Post()
  apply(@CurrentUser() user: JwtPayload, @Body() dto: CreateFacultyLeafDto) {
    return this.hodEmployeeLeaveService.apply(user.sub, dto);
  }
}
