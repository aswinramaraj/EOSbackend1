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
import { feedback_form_type_enum } from '../../../../generated/prisma/enums';
import { CreateFeedbackQuestionDto } from 'src/modules/feedback/feedback/dto/create-feedback-question.dto';

/**
 * A HoD's student feedback form - always targets exactly one class in the
 * HoD's own department (checked server-side). 'end_semester' asks every
 * question once per faculty mapped to that class (students rate each
 * subject-handling faculty); 'general' asks each question once (about
 * anything else).
 */
export class CreateHodStudentFeedbackDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsInt()
  @IsPositive()
  class_id: number;

  @IsOptional()
  @IsEnum(feedback_form_type_enum)
  form_type?: feedback_form_type_enum;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'A feedback form must have at least one question',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateFeedbackQuestionDto)
  questions: CreateFeedbackQuestionDto[];
}
