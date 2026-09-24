import { IsDateString, IsInt, IsPositive } from 'class-validator';

/**
 * POST /me/timetable-requests/takeover (Faculty/HoD).
 * `to_faculty_id` is who's being asked to cover — never resolved any other
 * way, the requester picks a specific colleague, not a broadcast.
 */
export class CreateTakeoverRequestDto {
  @IsInt()
  @IsPositive()
  primary_slot_id: number;

  @IsInt()
  @IsPositive()
  to_faculty_id: number;

  /** The exact calendar date this applies to — must fall on the same weekday as primary_slot_id's own day_of_week. */
  @IsDateString()
  request_date: string;
}
