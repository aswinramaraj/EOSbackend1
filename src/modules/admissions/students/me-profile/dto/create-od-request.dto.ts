import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Same HH:mm(:ss) pattern used by CreateExamTimetableDto for its
// start_time/end_time fields - kept consistent across the codebase's only
// two client-supplied time-of-day fields.
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/**
 * from_date/to_date/reason are checked here only for "present" (400
 * VALIDATION_ERROR territory) - reason (the event name, in the mobile UI's
 * own wording) is mandatory per the apply form's own spec, the same
 * standing as the dates. The business rule beyond that — not in the past,
 * from_date <= to_date — is checked in MeOdTeamsService as 422
 * INVALID_DATE_RANGE (a distinct errorCode the global ValidationPipe can't
 * produce), matching the DTO/service split used by CreateLeaveDto.
 *
 * from_time/to_time/faculty_guide_id are all optional and independent of
 * each other - od_requests has no NOT NULL pairing constraint across them,
 * so there's nothing in the schema requiring any of them together.
 */
export class CreateOdRequestDto {
  @IsDateString()
  from_date: string;

  @IsDateString()
  to_date: string;

  @IsString()
  @IsNotEmpty({ message: 'reason (event) is required' })
  @MaxLength(255)
  reason: string;

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'from_time must be in HH:mm or HH:mm:ss format' })
  from_time?: string;

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'to_time must be in HH:mm or HH:mm:ss format' })
  to_time?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  faculty_guide_id?: number;

  /** IQAC admin portal's "Organization"/"Location" detail fields - additive, optional. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;
}
