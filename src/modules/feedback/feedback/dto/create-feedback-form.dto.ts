import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  feedback_course_type_enum,
  feedback_form_type_enum,
} from '../../../../../generated/prisma/enums';
import { CreateFeedbackQuestionDto } from './create-feedback-question.dto';

export class CreateFeedbackFormDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  /** Target a single class. Leave unset to target an entire batch or the whole institute. Required when form_type is 'end_semester'. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  class_id?: number;

  /** Target every class in a batch. Ignored if class_id is set. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  batch_id?: number;

  /** Defaults to 'general' (schema default) when omitted. */
  @IsOptional()
  @IsEnum(feedback_form_type_enum)
  form_type?: feedback_form_type_enum;

  /** Rating scale for the faculty matrix. Only relevant when form_type is 'end_semester'; falls back to the seeded default scale if omitted. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  rating_scale_id?: number;

  /**
   * Optional category — also acts as a reusable question-bank key (see
   * GET question-templates). Leave unset to target everyone with a custom
   * question list, same as before this field existed. Silently ignored
   * until the pending migration in academic_coordinator.query.md #1 runs.
   */
  @IsOptional()
  @IsEnum(feedback_course_type_enum)
  category?: feedback_course_type_enum;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'A feedback form must have at least one question',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateFeedbackQuestionDto)
  questions: CreateFeedbackQuestionDto[];
}
