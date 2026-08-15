import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** POST /me/medical-centre-sickroom/:bedId/admit — visit_id ties the stay to a real OPD visit; both optional for a walk-in-less admission. */
export class AdmitBedDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  visit_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vitals?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  medication_given?: string;

  @IsOptional()
  @IsBoolean()
  guardian_contacted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  plan?: string;

  /** Minutes from now for the next review — converted to expected_review_at server-side. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  review_in_minutes?: number;
}
