import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExamDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_type_id must be an integer' })
  @IsPositive({ message: 'exam_type_id must be a positive integer' })
  exam_type_id: number;

  @Type(() => Number)
  @IsInt({ message: 'batch_id must be an integer' })
  @IsPositive({ message: 'batch_id must be a positive integer' })
  batch_id: number;

  @IsNotEmpty({ message: 'academic_year is required' })
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academic_year must be in the format YYYY-YYYY',
  })
  academic_year: string;

  @Type(() => Number)
  @IsInt({ message: 'semester must be an integer' })
  @Min(1, { message: 'semester must be at least 1' })
  @Max(12, { message: 'semester must not exceed 12' })
  semester: number;
}
