import {
  Controller,
  Get,
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
import { HodAcademicCalendarService } from './hod-academic-calendar.service';

@Controller('hod/academic-calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodAcademicCalendarController {
  constructor(
    private readonly hodAcademicCalendarService: HodAcademicCalendarService,
  ) {}

  /** GET /api/v1/hod/academic-calendar?year=2026&month=8 */
  @Get()
  getMonth(
    @CurrentUser() user: JwtPayload,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.hodAcademicCalendarService.getMonth(user.sub, year, month);
  }
}
