import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { sports_coach_duty_status_enum } from 'generated/prisma/client';

/** Matches the SearchOutingsDto pattern for validating a genuine Prisma enum. */
export const VALID_DUTY_STATUSES = Object.values(sports_coach_duty_status_enum);

export class CreateCoachProfileDto {
  @IsInt()
  faculty_id: number;

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
