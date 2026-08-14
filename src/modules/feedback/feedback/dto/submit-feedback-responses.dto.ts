import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class FeedbackResponseItemDto {
  @IsInt()
  @IsPositive()
  question_id: number;

  /**
   * Only present for the faculty-matrix (end_semester) path — identifies which
   * faculty_subject_class_mapping row (matrix row) this cell answers. Absent
   * entirely for general forms.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  mapping_id?: number;

  /** Required for 'text' questions. Ignored for 'rating' questions. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  response_text?: string;

  /**
   * Required for 'rating' questions. Only type-checked here — the actual
   * range differs per branch (general forms: fixed 1-5; end_semester forms:
   * whatever values the form's rating_scale defines), so the service checks
   * the real bound (class-validator's @ValidateIf gates a property's entire
   * validator set, so two different numeric bounds on one field can't be
   * expressed at the decorator level).
   */
  @IsOptional()
  @IsInt()
  rating_value?: number;
}

export class SubmitFeedbackResponsesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FeedbackResponseItemDto)
  responses: FeedbackResponseItemDto[];
}
