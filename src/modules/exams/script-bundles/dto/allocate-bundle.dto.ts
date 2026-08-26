import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class AllocateBundleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  bundle_code: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_subject_mapping_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  valuator_faculty_id?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  dummy_range_start: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  dummy_range_end: number;

  @IsOptional()
  @IsString()
  expected_return_at?: string;
}
