import {
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateFeedbackQuestionDto } from 'src/modules/feedback/feedback/dto/create-feedback-question.dto';

/** POST /hod/faculty-feedback-forms - sent to every faculty member of the HoD's own department. */
export class CreateFacultyFeedbackFormDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'A feedback form must have at least one question',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateFeedbackQuestionDto)
  questions: CreateFeedbackQuestionDto[];
}
