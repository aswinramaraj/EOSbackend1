import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** PATCH /stationary-requests/stock/:id — vendor sets the new quantity directly (a real stock count, not a delta). */
export class UpdateStockItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity_left: number;
}
