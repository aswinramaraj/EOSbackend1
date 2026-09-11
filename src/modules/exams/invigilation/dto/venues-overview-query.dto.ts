import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class VenuesOverviewQueryDto {
  @IsOptional()
  @IsString()
  academic_year?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  semester?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_type_id?: number;
}
