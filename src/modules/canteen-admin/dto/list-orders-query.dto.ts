import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsIn(['self', 'cashier'])
  source?: 'self' | 'cashier';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
