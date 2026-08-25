import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListRegulationsQueryDto {
  @IsOptional()
  @IsIn(['active', 'phasing_out', 'draft'])
  status?: 'active' | 'phasing_out' | 'draft';

  @IsOptional()
  @IsIn(['UG', 'PG'])
  level?: 'UG' | 'PG';

  @IsOptional()
  @IsString()
  scale?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
