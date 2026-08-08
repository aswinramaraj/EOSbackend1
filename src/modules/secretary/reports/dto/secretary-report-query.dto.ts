import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export enum SecretaryReportFormat {
  json = 'json',
  excel = 'excel',
  pdf = 'pdf',
}

/**
 * `status` is deliberately a plain optional string, not an `@IsIn(...)`
 * enum: this one query DTO is shared by five report endpoints whose
 * underlying tables each have a different status enum (secretary_request_
 * status_enum, venue_booking_status_enum, media_request_status_enum,
 * attendance_status_enum). An unrecognised value simply matches zero rows
 * (same as every other findAll() in this codebase passing an optional
 * `where.status`), rather than needing five near-duplicate DTOs.
 */
export class SecretaryReportQueryDto {
  @IsOptional()
  @IsEnum(SecretaryReportFormat)
  format?: SecretaryReportFormat = SecretaryReportFormat.json;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
