import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * POST /me/campus-outings — open to every student (day scholar or
 * hosteller), unlike /me/hostel-outings. from_date/to_date are checked
 * here only for "present and a valid date string" — the business rule
 * (not in the past, from_date <= to_date) is checked in
 * MeCampusOutingsService as 422 INVALID_DATE_RANGE, matching the
 * DTO/service split CreateHostelOutingDto/CreateLeaveDto both use.
 */
export class CreateCampusOutingDto {
  @IsDateString({}, { message: 'Please choose a valid out date' })
  from_date: string;

  @IsDateString({}, { message: 'Please choose a valid return date' })
  to_date: string;

  @Matches(TIME_PATTERN, { message: 'start_time must be a valid HH:MM time' })
  start_time: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'return_time must be a valid HH:MM time' })
  return_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
