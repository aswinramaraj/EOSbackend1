import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateFacultyOdRequestDto } from 'src/modules/faculty/faculty-od-requests/dto/create-faculty-od-request.dto';
import { HodEmployeeOdService } from './hod-employee-od.service';

@Controller('hod/employee/od')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeOdController {
  constructor(private readonly hodEmployeeOdService: HodEmployeeOdService) {}

  /** GET /api/v1/hod/employee/od/history?status= */
  @Get('history')
  getHistory(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: 'pending' | 'approved' | 'rejected',
  ) {
    return this.hodEmployeeOdService.getHistory(user.sub, status);
  }

  /** POST /api/v1/hod/employee/od */
  @Post()
  apply(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFacultyOdRequestDto,
  ) {
    return this.hodEmployeeOdService.apply(user.sub, dto);
  }
}
