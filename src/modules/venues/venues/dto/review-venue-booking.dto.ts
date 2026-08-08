import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * PATCH /venue-bookings/:id (IQAC only).
 *
 * workflow.md (IQAC): "venue reservation is reviewed by the IQAC and then
 * approval is granted or IQAC provides alternative venues available or
 * denotes no venue availability" — the three outcomes map directly to
 * venue_booking_status_enum's non-pending values (there is no "cancelled"
 * value). alternative_venue_id is the schema's own column for the
 * alternative-venue case; required exactly then, validated in the service.
 * reviewed_by_user_id is never client-supplied — derived from the JWT.
 */
export class ReviewVenueBookingDto {
  @IsIn(['approved', 'rejected', 'alternative_offered'])
  decision: 'approved' | 'rejected' | 'alternative_offered';

  @IsOptional()
  @IsInt()
  alternative_venue_id?: number;

  @IsOptional()
  @IsString()
  admin_remarks?: string;
}
