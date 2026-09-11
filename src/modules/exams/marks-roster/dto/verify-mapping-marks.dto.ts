import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class VerifyMappingMarksDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_subject_mapping_id!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  verified_by_faculty_id?: number;
}
