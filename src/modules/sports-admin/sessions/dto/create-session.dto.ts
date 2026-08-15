import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** HH:mm or HH:mm:ss, 24-hour. Matches how sports_training_sessions.start_time/end_time (@db.Time) are stored — same convention as timetable_slots. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * POST /sports-admin/sessions (Sports Admin / Admin only).
 *
 * Error cases:
 *  404 DISCIPLINE_NOT_FOUND – discipline_id does not exist
 */
export class CreateSessionDto {
  @IsInt()
  discipline_id: number;

  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsInt()
  coach_faculty_id?: number;

  @IsDateString({}, { message: 'session_date must be a valid ISO date' })
  session_date: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'start_time must be in HH:mm or HH:mm:ss (24-hour) format',
  })
  start_time?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'end_time must be in HH:mm or HH:mm:ss (24-hour) format',
  })
  end_time?: string;
}
