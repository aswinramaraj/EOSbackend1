import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { MedicalCentreDashboardController } from './medical-centre-dashboard.controller';
import { MedicalCentreDashboardService } from './medical-centre-dashboard.service';
import { MedicalCentreOpdController } from './medical-centre-opd.controller';
import { MedicalCentreOpdService } from './medical-centre-opd.service';
import { MedicalCentreRecordsController } from './medical-centre-records.controller';
import { MedicalCentreRecordsService } from './medical-centre-records.service';
import { MedicalCentreSickroomController } from './medical-centre-sickroom.controller';
import { MedicalCentreSickroomService } from './medical-centre-sickroom.service';
import { MedicalCentrePharmacyController } from './medical-centre-pharmacy.controller';
import { MedicalCentrePharmacyService } from './medical-centre-pharmacy.service';
import { MedicalCentreEquipmentController } from './medical-centre-equipment.controller';
import { MedicalCentreEquipmentService } from './medical-centre-equipment.service';
import { MedicalCentreAmbulanceController } from './medical-centre-ambulance.controller';
import { MedicalCentreAmbulanceService } from './medical-centre-ambulance.service';
import { MedicalCentreTeamController } from './medical-centre-team.controller';
import { MedicalCentreTeamService } from './medical-centre-team.service';
import { MedicalCentreCampsController } from './medical-centre-camps.controller';
import { MedicalCentreCampsService } from './medical-centre-camps.service';
import { MedicalCampRegistrationsService } from './medical-camp-registrations.service';
import { MedicalCentreBillingController } from './medical-centre-billing.controller';
import { MedicalCentreBillingService } from './medical-centre-billing.service';
import { MedicalCentreReportsController } from './medical-centre-reports.controller';
import { MedicalCentreReportsService } from './medical-centre-reports.service';
import { MedicalCentreAdvisoriesController } from './medical-centre-advisories.controller';
import { MedicalCentreAdvisoriesService } from './medical-centre-advisories.service';
import { MedicalCentreAppointmentsController } from './medical-centre-appointments.controller';
import { MedicalCentreAppointmentsService } from './medical-centre-appointments.service';
import { MedicalAppointmentsController } from './medical-appointments.controller';
import { MedicalAppointmentsService } from './medical-appointments.service';

@Module({
  // NotificationsModule: approving or rejecting an appointment tells the
  // person who booked it (MedicalCentreAppointmentsService.notifyDecision).
  imports: [PrismaModule, NotificationsModule],
  controllers: [
    MedicalCentreDashboardController,
    MedicalCentreOpdController,
    MedicalCentreRecordsController,
    MedicalCentreSickroomController,
    MedicalCentrePharmacyController,
    MedicalCentreEquipmentController,
    MedicalCentreAmbulanceController,
    MedicalCentreTeamController,
    MedicalCentreCampsController,
    MedicalCentreBillingController,
    MedicalCentreReportsController,
    MedicalCentreAdvisoriesController,
    MedicalCentreAppointmentsController,
    // Booking side. Its role list is far wider than every other controller
    // here (any non-parent user may book), so it stays its own controller
    // rather than another route on the staff one.
    MedicalAppointmentsController,
  ],
  providers: [
    MedicalCentreDashboardService,
    MedicalCentreOpdService,
    MedicalCentreRecordsService,
    MedicalCentreSickroomService,
    MedicalCentrePharmacyService,
    MedicalCentreEquipmentService,
    MedicalCentreAmbulanceService,
    MedicalCentreTeamService,
    MedicalCentreCampsService,
    MedicalCampRegistrationsService,
    MedicalCentreBillingService,
    MedicalCentreReportsService,
    MedicalCentreAdvisoriesService,
    MedicalCentreAppointmentsService,
    MedicalAppointmentsService,
  ],
})
export class MedicalCentreModule {}
