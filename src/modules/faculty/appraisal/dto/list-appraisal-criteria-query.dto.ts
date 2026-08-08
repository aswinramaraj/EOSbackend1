import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * GET /appraisal-criteria — optional academic_year filter. When omitted,
 * the service defaults to the most recent academic_year present in
 * appraisal_criteria (lexical max works since the format is fixed-width
 * "YYYY-YYYY").
 */
export class ListAppraisalCriteriaQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academic_year must be in the format YYYY-YYYY, e.g. 2025-2026',
  })
  academic_year?: string;
}
