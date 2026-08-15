import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalClassroomsController } from './classrooms/classrooms.controller';
import { PrincipalClassroomsService } from './classrooms/classrooms.service';
import { PrincipalLaboratoriesController } from './laboratories/laboratories.controller';
import { PrincipalLaboratoriesService } from './laboratories/laboratories.service';
import { PrincipalMedicalController } from './medical/medical.controller';
import { PrincipalMedicalService } from './medical/medical.service';
import { PrincipalSportsController } from './sports/sports.controller';
import { PrincipalSportsService } from './sports/sports.service';
import { PrincipalLibraryController } from './library/library.controller';
import { PrincipalLibraryService } from './library/library.service';
import { PrincipalVenueBookingsController } from './venue-bookings/venue-bookings.controller';
import { PrincipalVenueBookingsService } from './venue-bookings/venue-bookings.service';
import { PrincipalFacilitiesHubController } from './hub/hub.controller';
import { PrincipalFacilitiesHubService } from './hub/hub.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    PrincipalFacilitiesHubController,
    PrincipalClassroomsController,
    PrincipalLaboratoriesController,
    PrincipalMedicalController,
    PrincipalSportsController,
    PrincipalLibraryController,
    PrincipalVenueBookingsController,
  ],
  providers: [
    PrincipalFacilitiesHubService,
    PrincipalClassroomsService,
    PrincipalLaboratoriesService,
    PrincipalMedicalService,
    PrincipalSportsService,
    PrincipalLibraryService,
    PrincipalVenueBookingsService,
  ],
})
export class PrincipalFacilitiesModule {}
