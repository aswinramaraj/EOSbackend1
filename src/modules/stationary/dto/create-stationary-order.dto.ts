import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

const ORIENTATIONS = ['portrait', 'landscape'] as const;
const COLOR_MODES = ['color', 'bw'] as const;
const PAPER_SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal'] as const;
const SIDES = ['Single-sided', 'Double-sided'] as const;
const BINDINGS = ['No binding', 'Spiral binding', 'Calico binding'] as const;

/**
 * POST /me/stationary-requests/order
 *
 * `total_pages` is a client-declared quantity (no PDF-parsing capability
 * exists anywhere in this app), same trust model as e.g.
 * venue_bookings.accommodating_strength - what the server never trusts is
 * the price: `amount` is always recomputed here from total_pages * copies
 * * PRICE_PER_PAGE (see StationaryService), regardless of what the client
 * might otherwise imply.
 */
export class CreateStationaryOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_summary?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  total_pages: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  copies: number;

  @IsIn(ORIENTATIONS)
  orientation: (typeof ORIENTATIONS)[number];

  @IsIn(COLOR_MODES)
  color_mode: (typeof COLOR_MODES)[number];

  @IsIn(PAPER_SIZES)
  paper_size: (typeof PAPER_SIZES)[number];

  @IsIn(SIDES)
  sides: (typeof SIDES)[number];

  @IsIn(BINDINGS)
  binding: (typeof BINDINGS)[number];
}
