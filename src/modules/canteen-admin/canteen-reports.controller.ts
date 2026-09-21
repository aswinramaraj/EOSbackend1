import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenReportsService } from './canteen-reports.service';
import { DateRangeQueryDto } from './dto/date-range-query.dto';

@Controller('canteen-admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenReportsController {
  constructor(private readonly reports: CanteenReportsService) {}

  @Get('billing-details')
  getBillingDetails(@Query() query: DateRangeQueryDto) {
    return this.reports.getBillingDetails(query);
  }

  @Get('analytics')
  getAnalytics(@Query() query: DateRangeQueryDto) {
    return this.reports.getAnalytics(query);
  }
}
