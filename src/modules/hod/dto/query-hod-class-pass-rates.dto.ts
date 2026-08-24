import { IsIn, IsOptional } from 'class-validator';

export class QueryHodClassPassRatesDto {
  @IsOptional()
  @IsIn(['I', 'II', 'III', 'IV'])
  year?: string;
}
