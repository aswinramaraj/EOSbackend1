import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * GET /me/timetable (Student only).
 *
 * `week` has no corresponding column anywhere on timetable_slots (only
 * academic_year + semester) — its semantics are undefined per the API doc
 * ("Pending from Backend Implementation"). Accepted here so the request
 * validates, but it is never used to filter the query.
 *
 * `day` range is 1-6 (Monday-Saturday, no Sunday classes), matching this
 * module's one established day_of_week convention (see CreateTimetableDto) —
 * not 1-7; day_of_week can never actually be 7 for any real row.
 *
 * `date` (optional, YYYY-MM-DD) — when supplied together with `day`, that
 * exact calendar date's accepted timetable_period_requests overlay is
 * applied on top of the recurring day-of-week rows (e.g. a faculty covering
 * this class's period today shows up instead of the normal teacher, but
 * only for this one date). Omitted, the response is the plain recurring
 * schedule exactly as before — this parameter is additive, not a breaking
 * change to any existing caller.
 */
export class GetMyTimetableQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  day?: number;

  @IsOptional()
  @IsString()
  week?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
