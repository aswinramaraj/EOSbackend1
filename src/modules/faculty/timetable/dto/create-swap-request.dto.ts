import { IsDateString, IsInt, IsPositive } from 'class-validator';

/**
 * POST /me/timetable-requests/swap (Faculty/HoD).
 * `to_faculty_id` is deliberately NOT part of this DTO — it's always
 * resolved server-side from secondary_slot_id's own owning faculty, never
 * client-supplied, so a caller can't name a swap partner who doesn't
 * actually teach that period.
 */
export class CreateSwapRequestDto {
  @IsInt()
  @IsPositive()
  primary_slot_id: number;

  /** The other faculty's real timetable_slots.id being proposed for the trade. */
  @IsInt()
  @IsPositive()
  secondary_slot_id: number;

  /** The exact calendar date this applies to — both slots must fall on this date's weekday. */
  @IsDateString()
  request_date: string;
}
