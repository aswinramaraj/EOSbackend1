import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * PATCH /venue-bookings/:id/reallocate (IQAC only).
 *
 * Distinct from ReviewVenueBookingDto's 'alternative_offered' decision:
 * reallocating moves the booking straight to the new venue and marks it
 * 'approved' (a decision, not a suggestion) — usable on a still-pending
 * booking or one already 'rejected' (see VenuesService.reallocateBooking).
 */
export class ReallocateVenueBookingDto {
  @IsInt()
  venue_id: number;

  @IsOptional()
  @IsString()
  admin_remarks?: string;
}
