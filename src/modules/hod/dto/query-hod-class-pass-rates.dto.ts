import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class QueryHodClassPassRatesDto {
  @IsOptional()
  @IsIn(['I', 'II', 'III', 'IV'])
  year?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
