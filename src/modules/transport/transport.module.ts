import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TransportDashboardController } from './transport-dashboard.controller';
import { TransportDashboardService } from './transport-dashboard.service';
import { TransportNoticesController } from './transport-notices.controller';
import { TransportNoticesService } from './transport-notices.service';
import { TransportBusesController } from './transport-buses.controller';
import { TransportBusesService } from './transport-buses.service';
import { TransportRoutesController } from './transport-routes.controller';
import { TransportRoutesService } from './transport-routes.service';
import { TransportCrewController } from './transport-crew.controller';
import { TransportCrewService } from './transport-crew.service';
import { TransportMaintenanceController } from './transport-maintenance.controller';
import { TransportMaintenanceService } from './transport-maintenance.service';
import { TransportComplianceController } from './transport-compliance.controller';
import { TransportComplianceService } from './transport-compliance.service';
import { TransportBusDetailController } from './transport-bus-detail.controller';
import { TransportBusDetailService } from './transport-bus-detail.service';
import { TransportBusWriteService } from './transport-bus-write.service';
import { TransportStagesController } from './transport-stages.controller';
import { TransportRouteEditService } from './transport-route-edit.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    TransportDashboardController,
    TransportNoticesController,
    TransportBusesController,
    TransportRoutesController,
    TransportCrewController,
    TransportMaintenanceController,
    TransportComplianceController,
    TransportBusDetailController,
    TransportStagesController,
  ],
  providers: [
    TransportDashboardService,
    TransportNoticesService,
    TransportBusesService,
    TransportRoutesService,
    TransportCrewService,
    TransportMaintenanceService,
    TransportComplianceService,
    TransportBusDetailService,
    TransportBusWriteService,
    TransportRouteEditService,
  ],
})
export class TransportModule {}
