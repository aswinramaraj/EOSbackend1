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
import { ApiResponse } from 'src/common';
import { StaffAccountsService } from './staff-accounts.service';
import { CreateStaffAccountDto } from './dto/create-staff-account.dto';
import { ListStaffAccountsQueryDto } from './dto/list-staff-accounts-query.dto';
import { UpdateStaffAccountStatusDto } from './dto/update-staff-account-status.dto';
import { ResetStaffAccountPasswordDto } from './dto/reset-staff-account-password.dto';

/**
 * Fixes Finding 1 (see docs/production/ERP_END_TO_END_AUDIT.md): the one
 * generic login-creation screen for every role that had no creation flow at
 * all — Admin/Faculty/Student/HoD/Parent/Alumni each keep their own
 * dedicated flow elsewhere and are deliberately excluded here.
 */
@Controller('staff-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
export class StaffAccountsController {
  constructor(private readonly staffAccountsService: StaffAccountsService) {}

  /** GET /api/v1/staff-accounts/roles — dropdown source for the create form. */
  @Get('roles')
  listRoles() {
    return this.staffAccountsService.listProvisionableRoles();
  }

  /** POST /api/v1/staff-accounts — Admin/HR Payroll. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateStaffAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const account = await this.staffAccountsService.create(dto, user.sub);
    return ApiResponse.created(account, 'Account created successfully');
  }

  /** GET /api/v1/staff-accounts — Admin/HR Payroll. Paginated, filterable by role_name/status/search. */
  @Get()
  findAll(@Query() query: ListStaffAccountsQueryDto) {
    return this.staffAccountsService.findAll(query);
  }

  /** PATCH /api/v1/staff-accounts/:id/status — Admin/HR Payroll. Activate/deactivate. */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStaffAccountStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffAccountsService.updateStatus(id, dto.status, user.sub);
  }

  /** POST /api/v1/staff-accounts/:id/reset-password — Admin/HR Payroll. Returns the new temporary password once. Requires the caller's own password as step-up confirmation. */
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetStaffAccountPasswordDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffAccountsService.resetPassword(id, dto, user.sub);
  }
}
