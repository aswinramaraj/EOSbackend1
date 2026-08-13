import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodFacultyStaffService } from './hod-faculty-staff.service';

/**
 * HoD Faculty & Staff — HoD only. Every lookup is re-verified against the
 * caller's own department server-side, so a client can never pull another
 * department's staff data by tampering with an id.
 */
@Controller('hod/faculty-staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodFacultyStaffController {
  constructor(
    private readonly hodFacultyStaffService: HodFacultyStaffService,
  ) {}

  /** GET /api/v1/hod/faculty-staff/overview — stat cards for the list page. */
  @Get('overview')
  getOverview(@CurrentUser() user: JwtPayload) {
    return this.hodFacultyStaffService.getOverview(user.sub);
  }

  /** GET /api/v1/hod/faculty-staff/list?type=all|teaching|non_teaching&search= */
  @Get('list')
  getList(
    @CurrentUser() user: JwtPayload,
    @Query('type') type?: 'all' | 'teaching' | 'non_teaching',
    @Query('search') search?: string,
  ) {
    return this.hodFacultyStaffService.getList(user.sub, type ?? 'all', search);
  }

  /** GET /api/v1/hod/faculty-staff/faculty/:id */
  @Get('faculty/:id')
  getFacultyProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hodFacultyStaffService.getFacultyProfile(user.sub, id);
  }

  /** GET /api/v1/hod/faculty-staff/non-teaching/:id */
  @Get('non-teaching/:id')
  getNonTeachingProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hodFacultyStaffService.getNonTeachingProfile(user.sub, id);
  }
}
