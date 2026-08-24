import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ListSpecialAdmissionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  class_id?: number;

  @IsOptional()
  @IsIn(['lateral_entry', 'transfer'])
  category?: 'lateral_entry' | 'transfer';

  @IsOptional()
  @IsString()
  search?: string;
}
