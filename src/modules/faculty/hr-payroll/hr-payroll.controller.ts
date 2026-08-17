import {
  Body,
  Controller,
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
import { HrPayrollService } from './hr-payroll.service';
import { CreateHrPayrollDto } from './dto/create-hr-payroll.dto';
import { UpdateHrPayrollDto } from './dto/update-hr-payroll.dto';
import { ListHrPayrollQueryDto } from './dto/list-hr-payroll-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HrPayrollController {
  constructor(private readonly hrPayrollService: HrPayrollService) {}

  /** POST /api/v1/hr-payroll — HR Payroll only. */
  @Post('hr-payroll')
  @Roles(ROLES.HR_PAYROLL)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateHrPayrollDto, @CurrentUser() user: JwtPayload) {
    return this.hrPayrollService.create(dto, user.sub);
  }

  /** GET /api/v1/hr-payroll — HR Payroll (all)/Faculty/Secretary (own only). Paginated, filterable. */
  @Get('hr-payroll')
  @Roles(ROLES.HR_PAYROLL, ROLES.FACULTY, ROLES.SECRETARY)
  findAll(
    @Query() query: ListHrPayrollQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrPayrollService.findAll(query, user);
  }

  /** GET /api/v1/hr-payroll/:id — HR Payroll (all)/Faculty/Secretary (own only). */
  @Get('hr-payroll/:id')
  @Roles(ROLES.HR_PAYROLL, ROLES.FACULTY, ROLES.SECRETARY)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrPayrollService.findOne(id, user);
  }

  /** PATCH /api/v1/hr-payroll/:id — HR Payroll only. */
  @Patch('hr-payroll/:id')
  @Roles(ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHrPayrollDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrPayrollService.update(id, dto, user.sub);
  }
}
