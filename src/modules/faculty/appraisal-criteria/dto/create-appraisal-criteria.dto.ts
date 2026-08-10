import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * POST /appraisal-criteria (Admin/HR Payroll only).
 *
 * Matches the current appraisal_criteria columns exactly: division_id,
 * criteria_name, max_score, academic_year. No weightage_percent/status/
 * created_by_user_id yet — those depend on a pending schema change and will
 * be added to this DTO once that lands.
 */
export class CreateAppraisalCriteriaDto {
  @Type(() => Number)
  @IsInt()
  division_id: number;

  @IsString()
  @MaxLength(150)
  criteria_name: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  max_score: number;

  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academic_year must be in the format YYYY-YYYY, e.g. 2025-2026',
  })
  academic_year: string;
}
