import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyOdDto {
  @IsDateString()
  from_date: string;

  @IsDateString()
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  organization_visited?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  od_type?: string;

  /** Real column, previously never read/written by this service — the design's "Periods Affected" field. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  periods_affected?: string;

  /** Real column, previously never read/written by this service — the design's "Class Adjustment" field. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  class_adjustment?: string;
}
