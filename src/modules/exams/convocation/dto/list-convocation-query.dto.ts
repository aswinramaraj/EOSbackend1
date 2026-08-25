import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListConvocationQueryDto {
  @IsOptional()
  @IsIn(['eligible', 'shortfall', 'registered', 'degree_awarded'])
  status?: 'eligible' | 'shortfall' | 'registered' | 'degree_awarded';

  @IsOptional()
  @IsString()
  search?: string;
}
