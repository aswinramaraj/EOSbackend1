import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { feedback_course_type_enum } from '../../../../../generated/prisma/enums';

export class UpdateFeedbackFormDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  class_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  batch_id?: number;

  @IsOptional()
  @IsEnum(feedback_course_type_enum)
  category?: feedback_course_type_enum;
}
