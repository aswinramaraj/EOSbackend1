import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExamDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'title must not exceed 200 characters' })
  title?: string;

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

  @IsOptional()
  @IsIn(['regular', 'arrear', 'supplementary'])
  exam_category?: 'regular' | 'arrear' | 'supplementary';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'registration_opens_at must be YYYY-MM-DD' })
  registration_opens_at?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'registration_closes_at must be YYYY-MM-DD' })
  registration_closes_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsPositive({ message: 'fee_amount must be a positive number' })
  fee_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'notes_to_students must not exceed 500 characters' })
  notes_to_students?: string;
}
