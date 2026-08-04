import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClassDto {
  @Type(() => Number)
  @IsInt({ message: 'batch_id must be an integer' })
  @IsPositive({ message: 'batch_id must be a positive integer' })
  batch_id: number;

  @Type(() => Number)
  @IsInt({ message: 'department_id must be an integer' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id: number;

  @Type(() => Number)
  @IsInt({ message: 'course_id must be an integer' })
  @IsPositive({ message: 'course_id must be a positive integer' })
  course_id: number;

  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  @MinLength(1, { message: 'Section must be at least 1 character' })
  @MaxLength(5, { message: 'Section must not exceed 5 characters' })
  section: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'current_semester must be an integer' })
  @IsPositive({ message: 'current_semester must be a positive integer' })
  current_semester?: number;
}
