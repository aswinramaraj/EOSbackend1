// subjects/dto/create-subject.dto.ts
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  subject_category_enum,
  subject_course_type_enum,
} from '../../../../../generated/prisma/enums';

export class CreateSubjectDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Subject name is required' })
  @MaxLength(150, { message: 'Subject name must not exceed 150 characters' })
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Subject code is required' })
  @MaxLength(30, { message: 'Subject code must not exceed 30 characters' })
  subject_code: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'department_id must be an integer' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'credits must be an integer' })
  @IsPositive({ message: 'credits must be a positive integer' })
  credits?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(20, { message: 'Short code must not exceed 20 characters' })
  short_code?: string;

  @IsOptional()
  @IsEnum(subject_course_type_enum, { message: 'Invalid course type' })
  course_type?: subject_course_type_enum;

  @IsOptional()
  @IsEnum(subject_category_enum, { message: 'Invalid category' })
  category?: subject_category_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'hours must be an integer' })
  @Min(1, { message: 'hours must be at least 1' })
  @Max(200, { message: 'hours must be at most 200' })
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'semester must be an integer' })
  @Min(1, { message: 'semester must be between 1 and 8' })
  @Max(8, { message: 'semester must be between 1 and 8' })
  semester?: number;
}
