import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { sports_coach_duty_status_enum } from 'generated/prisma/client';
import { VALID_DUTY_STATUSES } from './create-coach-profile.dto';

/**
 * Deliberately does NOT extend CreateCoachProfileDto / PartialType(...) — that
 * dto carries faculty_id, and this endpoint must only ever touch the
 * sports_coach_profiles columns, never re-point the profile at a different
 * faculty row.
 */
export class UpdateCoachProfileDto {
  @IsOptional()
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coaching_experience_years?: number;

  @IsOptional()
  @IsIn(VALID_DUTY_STATUSES, {
    message: `duty_status must be a valid coach duty status value (${VALID_DUTY_STATUSES.join(', ')})`,
  })
  duty_status?: sports_coach_duty_status_enum;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  certifications?: string[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  responsibilities?: string[];
}
