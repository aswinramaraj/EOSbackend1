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

const STATUSES = ['enrolled', 'in_progress', 'completed'] as const;

/** The reference design's "Add faculty entry" popup for Faculty Certifications — a real faculty_certifications row. */
export class AddFacultyCertificationEntryDto {
  @IsInt()
  @IsPositive()
  faculty_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  platform: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  track: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  score?: string;

  @IsOptional()
  @IsDateString()
  completed_on?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  certificate_url?: string;
}
