import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

/**
 * POST /me/stationary-requests/order — the amount is never taken from the
 * client. It's computed server-side from copies/color_mode (see
 * StationaryService.PRICING) so a tampered request body can't under-price
 * a print job, same reasoning as CreateTopupOrderDto being the one place
 * client-supplied money ever gets trusted (and even there, only because a
 * top-up has no "price" to compute - a print job does).
 */
export class CreateStationaryOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  copies: number;

  @IsIn(['portrait', 'landscape'])
  orientation: 'portrait' | 'landscape';

  @IsIn(['color', 'bw'])
  color_mode: 'color' | 'bw';

  @IsIn(['all', 'even', 'odd'])
  pages: 'all' | 'even' | 'odd';
}
