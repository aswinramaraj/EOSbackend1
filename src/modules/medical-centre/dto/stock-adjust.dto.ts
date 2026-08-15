import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class StockAdjustDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}
