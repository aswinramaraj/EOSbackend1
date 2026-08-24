import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

const STATUSES = ['registered', 'attended', 'completed'] as const;

/** The reference design's "Add faculty entry" popup for FDP/STTP — a real faculty_development_programs row (program_type is fixed by the route, not client-supplied). */
export class AddDevelopmentProgramEntryDto {
  @IsInt()
  @IsPositive()
  faculty_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  programme_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host_agency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  duration?: string;

  @IsOptional()
  @IsDateString()
  attended_on?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
