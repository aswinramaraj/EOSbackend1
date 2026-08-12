import { Injectable } from '@nestjs/common';
import { PrincipalClassroomsService } from '../classrooms/classrooms.service';
import { PrincipalLaboratoriesService } from '../laboratories/laboratories.service';
import { PrincipalMedicalService } from '../medical/medical.service';
import { PrincipalSportsService } from '../sports/sports.service';
import { PrincipalLibraryService } from '../library/library.service';
import { PrincipalVenueBookingsService } from '../venue-bookings/venue-bookings.service';

/** GET /me/principal/facilities/hub — the "Campus & facilities" landing page card summaries, reusing each sub-area's own service rather than re-querying. */
@Injectable()
export class PrincipalFacilitiesHubService {
  constructor(
    private readonly classrooms: PrincipalClassroomsService,
    private readonly laboratories: PrincipalLaboratoriesService,
    private readonly medical: PrincipalMedicalService,
    private readonly sports: PrincipalSportsService,
    private readonly library: PrincipalLibraryService,
    private readonly venueBookings: PrincipalVenueBookingsService,
  ) {}

  async summary() {
    const [
      classroomsData,
      labsData,
      medicalSummary,
      sportsSummary,
      librarySummary,
      bookingsThisMonth,
    ] = await Promise.all([
      this.classrooms.list(),
      this.laboratories.list(),
      this.medical.summary(),
      this.sports.summary(),
      this.library.summary(),
      this.venueBookings.list('month'),
    ]);

    return {
      classrooms: {
        tracked: classroomsData.tracked,
        rooms_count: classroomsData.total,
        blocks_count: classroomsData.blocks_count,
      },
      laboratories: { tracked: labsData.tracked, labs_count: labsData.total },
      medical: {
        equipment_types: medicalSummary.equipment_types,
        equipment_total_quantity: medicalSummary.equipment_total_quantity,
      },
      sports: { disciplines_count: sportsSummary.disciplines_count },
      library: { distinct_titles: librarySummary.distinct_titles },
      venue_bookings: { this_month_count: bookingsThisMonth.total },
    };
  }
}
