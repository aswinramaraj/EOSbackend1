import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One student's mark within a POST /me/exams/:exam_subject_mapping_id/marks
 * batch. marks_obtained is optional only when is_absent is true — an absent
 * student has no mark, not a zero — enforced in the service since it's a
 * cross-field check.
 */
export class ExamMarkEntryItemDto {
  @IsInt()
  student_id: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marks_obtained?: number;

  @IsOptional()
  @IsBoolean()
  is_absent?: boolean;
}

/**
 * POST /me/exams/:exam_subject_mapping_id/marks (Faculty only).
 * exam_subject_mapping_id is a path param, not a body field. The
 * [0, max_marks] range check is cross-field (depends on this DTO's own
 * max_marks), so it's enforced in the service, not here.
 */
export class EnterExamMarksDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  max_marks: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExamMarkEntryItemDto)
  entries: ExamMarkEntryItemDto[];
}
