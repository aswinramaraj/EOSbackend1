import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { sports_session_status_enum } from 'generated/prisma/client';
import { TIME_PATTERN } from './create-session.dto';

const VALID_STATUSES = Object.values(sports_session_status_enum);

/**
 * PATCH /sports-admin/sessions/:id
 *
 * Intentionally does NOT expose discipline_id — the spec's field list for
 * this endpoint is facility_id/coach_faculty_id/session_date/start_time/
 * end_time/status only, so moving a session to a different discipline is
 * out of scope here.
 *
 * Error cases:
 *  404 SESSION_NOT_FOUND – no session with the given id
 */
export class UpdateSessionDto {
  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsInt()
  coach_faculty_id?: number;

  @IsOptional()
  @IsDateString({}, { message: 'session_date must be a valid ISO date' })
  session_date?: string;

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

  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid session status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: sports_session_status_enum;
}
