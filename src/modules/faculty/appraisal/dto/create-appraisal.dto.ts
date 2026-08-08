import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * One line item within a POST /appraisal submission.
 *
 * appraisal_entries has NO subjects_handled/student_projects/online_courses/
 * paper_publications columns — schema.prisma is the source of truth. The real
 * shape is criteria_id + description + score, and score is deliberately not
 * accepted here: per workflow.md ("HR department creates score for each
 * entry"), scoring is HR's job during PATCH, not the faculty's at submission.
 */
export class AppraisalEntryInputDto {
  @IsInt()
  criteria_id: number;

  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * POST /appraisal (Faculty only).
 *
 * `faculty_id` is never accepted from the client — the service derives it
 * from the authenticated faculty (@CurrentUser().sub), same pattern as every
 * other self-service module (Attendance, Lesson Plans, LMS Notes, Faculty
 * Leaves). `hod_score`/`hr_remarks` don't exist anywhere in the schema and
 * are not accepted at any stage of this module.
 */
export class CreateAppraisalDto {
  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academic_year must be in the format YYYY-YYYY, e.g. 2025-2026',
  })
  academic_year: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AppraisalEntryInputDto)
  entries: AppraisalEntryInputDto[];
}
