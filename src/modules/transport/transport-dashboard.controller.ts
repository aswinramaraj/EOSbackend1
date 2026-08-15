import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportDashboardService } from './transport-dashboard.service';
import { GetTransportDashboardQueryDto } from './dto/get-transport-dashboard-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportDashboardController {
  constructor(private readonly service: TransportDashboardService) {}

  /** GET /api/v1/me/transport-dashboard?period=today|term|year — fleet, ridership, renewals and notices for the transport office. */
  @Get('transport-dashboard')
  getDashboard(@Query() query: GetTransportDashboardQueryDto) {
    return this.service.getDashboard(query.period);
  }
}
