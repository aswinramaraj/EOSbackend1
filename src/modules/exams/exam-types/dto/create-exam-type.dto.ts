import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum ExamTypeCategory {
  internal = 'internal',
  external = 'external',
}

export class CreateExamTypeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Exam Type name is required.' })
  @MaxLength(50, { message: 'Exam Type name must not exceed 50 characters.' })
  name: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(20, { message: 'code must not exceed 20 characters.' })
  code?: string;

  @IsOptional()
  @IsEnum(ExamTypeCategory, {
    message: 'category must be either internal or external',
  })
  category?: ExamTypeCategory;

  @IsOptional()
  @IsBoolean({ message: 'is_university must be a boolean' })
  is_university?: boolean;
}
