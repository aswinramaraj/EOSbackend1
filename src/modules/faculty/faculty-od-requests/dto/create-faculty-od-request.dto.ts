import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * POST /faculty-od-requests (Faculty only).
 *
 * `faculty_id` is never client-supplied — the service derives it from the
 * authenticated faculty (@CurrentUser().sub), same pattern as Faculty Leaves.
 * hod_approval_status/hr_approval_status/verification_status are
 * system-controlled and never accepted here — they start at their schema
 * defaults ('pending'/'pending'/'awaiting_documents').
 *
 * Photo/certificate upload and geo-tagging (photo_url, certificate_url,
 * latitude, longitude) are intentionally out of scope for this endpoint —
 * they belong to a separate upload flow that isn't built yet.
 */
export class CreateFacultyOdRequestDto {
  @IsDateString({}, { message: 'from_date must be a valid ISO date' })
  from_date: string;

  @IsDateString({}, { message: 'to_date must be a valid ISO date' })
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  organization_visited?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  students_guided?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sanction_order?: string;
}
