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
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalTransportService } from './transport.service';
import { TransportRoutesService } from 'src/modules/transport/transport-routes.service';
import { TransportCrewService } from 'src/modules/transport/transport-crew.service';
import { TransportMaintenanceService } from 'src/modules/transport/transport-maintenance.service';
import { TransportComplianceService } from 'src/modules/transport/transport-compliance.service';
import { TransportDashboardService } from 'src/modules/transport/transport-dashboard.service';
import { GetTransportDashboardQueryDto } from 'src/modules/transport/dto/get-transport-dashboard-query.dto';

/**
 * GET /api/v1/me/principal/transport/* — Principal only, read-only.
 *
 * routes/crew/maintenance/compliance/dashboard delegate straight to the
 * exact same services the Transport-admin role's own module uses (see
 * TransportModule's `exports`) — full read parity with that module without
 * duplicating a single query. Only `buses`' list/detail (below) has its own
 * PrincipalTransportService, predating this pass.
 *
 * Static-path routes are declared before the `:id` param route so Nest's
 * declaration-order route matching doesn't shadow them (e.g. a request for
 * `/transport/routes` must not be captured by `findOne(':id')`).
 */
@Controller('me/principal/transport')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalTransportController {
  constructor(
    private readonly transportService: PrincipalTransportService,
    private readonly routesService: TransportRoutesService,
    private readonly crewService: TransportCrewService,
    private readonly maintenanceService: TransportMaintenanceService,
    private readonly complianceService: TransportComplianceService,
    private readonly dashboardService: TransportDashboardService,
  ) {}

  /** GET /me/principal/transport/dashboard?period=today|term|year */
  @Get('dashboard')
  getDashboard(@Query() query: GetTransportDashboardQueryDto) {
    return this.dashboardService.getDashboard(query.period);
  }

  /** GET /me/principal/transport/routes?search= */
  @Get('routes')
  getRoutes(@Query('search') search?: string) {
    return this.routesService.findAll(search);
  }

  /** GET /me/principal/transport/crew?search= */
  @Get('crew')
  getCrew(@Query('search') search?: string) {
    return this.crewService.findAll(search);
  }

  /** GET /me/principal/transport/maintenance */
  @Get('maintenance')
  getMaintenance() {
    return this.maintenanceService.getMaintenance();
  }

  /** GET /me/principal/transport/compliance */
  @Get('compliance')
  getCompliance() {
    return this.complianceService.getCompliance();
  }

  @Get()
  list() {
    return this.transportService.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.transportService.findOne(id);
  }
}
