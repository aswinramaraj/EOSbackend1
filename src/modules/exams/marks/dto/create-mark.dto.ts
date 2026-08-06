// dto/create-mark.dto.ts
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMarkDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_subject_mapping_id must be an integer' })
  @IsPositive({ message: 'exam_subject_mapping_id must be a positive integer' })
  exam_subject_mapping_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'student_id must be an integer' })
  @IsPositive({ message: 'student_id must be a positive integer' })
  student_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'marks_obtained must be a number' })
  @Min(0, { message: 'marks_obtained cannot be negative' })
  marks_obtained?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'max_marks must be a number' })
  @IsPositive({ message: 'max_marks must be a positive number' })
  max_marks!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'entered_by_faculty_id must be an integer' })
  @IsPositive({ message: 'entered_by_faculty_id must be a positive integer' })
  entered_by_faculty_id?: number;

  @IsOptional()
  @IsBoolean({ message: 'is_absent must be a boolean' })
  is_absent?: boolean;
}
