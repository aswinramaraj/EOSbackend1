import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FacultyFeedbackAnswerDto {
  @IsInt()
  @IsPositive()
  question_id: number;

  /** Required for a 'rating' question (1-5). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating_value?: number;

  /** Required for a 'text' question. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  response_text?: string;
}

/** POST /me/faculty-feedback/forms/:id/responses - every question answered, once. */
export class SubmitFacultyFeedbackDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FacultyFeedbackAnswerDto)
  responses: FacultyFeedbackAnswerDto[];
}
