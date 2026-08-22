import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateCourseDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Course name, code, and department_id are required' })
  @MaxLength(150, { message: 'Course name must not exceed 150 characters' })
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Course name, code, and department_id are required' })
  @MaxLength(30, { message: 'Course code must not exceed 30 characters' })
  code: string;

  @Type(() => Number)
  @IsInt({ message: 'Course name, code, and department_id are required' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'duration_years must be a positive number' })
  @IsPositive({ message: 'duration_years must be a positive number' })
  @Max(6, { message: 'duration_years must not exceed 6 years' })
  duration_years?: number;
}
