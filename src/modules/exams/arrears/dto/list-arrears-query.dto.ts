import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListArrearsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  year?: number;

  @IsOptional()
  @IsIn(['registered', 'not_eligible', 'cleared', 'pending'])
  status?: 'registered' | 'not_eligible' | 'cleared' | 'pending';
}
