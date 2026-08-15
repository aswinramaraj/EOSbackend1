import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsPositive, IsString, Matches, MaxLength } from 'class-validator';

// Same HH:mm(:ss) pattern used by CreateOdRequestDto/CreateExamTimetableDto
// for their own time-of-day fields.
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/**
 * POST /me/od-teams — the creator now supplies the full event brief up
 * front (team_name/reason/venue/dates/times/faculty_guide_id), all stored
 * on od_teams itself rather than only at the later lock-and-submit step.
 * That later step (submitOdRequest) still exists for the approval-fan-out
 * workflow, but now falls back to these team-level values when the
 * request body omits them — see CreateOdRequestDto.
 *
 * The same "not in the past, from_date <= to_date" business check used for
 * CreateOdRequestDto applies here too (checked in the service as 422
 * INVALID_DATE_RANGE, not in this DTO).
 */
export class CreateOdTeamDto {
  @IsString()
  @IsNotEmpty({ message: 'team_name is required' })
  @MaxLength(150)
  team_name: string;

  @IsString()
  @IsNotEmpty({ message: 'reason (event) is required' })
  @MaxLength(255)
  reason: string;

  @IsString()
  @IsNotEmpty({ message: 'venue is required' })
  @MaxLength(255)
  venue: string;

  @IsDateString()
  from_date: string;

  @IsDateString()
  to_date: string;

  @Matches(TIME_REGEX, { message: 'from_time must be in HH:mm or HH:mm:ss format' })
  from_time: string;

  @Matches(TIME_REGEX, { message: 'to_time must be in HH:mm or HH:mm:ss format' })
  to_time: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  faculty_guide_id: number;
}
