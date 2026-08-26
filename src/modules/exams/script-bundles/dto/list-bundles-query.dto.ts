import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ListBundlesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id?: number;

  @IsOptional()
  @IsIn(['allotted', 'under_valuation', 'submitted'])
  status?: 'allotted' | 'under_valuation' | 'submitted';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_second_valuation?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
