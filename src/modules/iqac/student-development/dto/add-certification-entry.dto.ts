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

/**
 * The reference design's "Add student entry" popup for Certifications —
 * a real student_certificates row with certificate_type_id left null
 * (that column now identifies admin-issued documents; this is a real
 * skill/course certification instead, see the platform/track/score/
 * completed_on/status columns added alongside it).
 */
export class AddCertificationEntryDto {
  @IsInt()
  @IsPositive()
  student_id: number;

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
}
