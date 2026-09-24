import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

const PAYMENT_MODES = ['upi', 'cash', 'internal_voucher'] as const;

/**
 * POST /stationary-requests/counter (Stationary vendor / Admin) — an
 * in-person job with no linked student/staff account, per the Stationery
 * Portal design's "Add entry" modal. Unlike CreateStationaryOrderDto (the
 * online student-facing flow, where `amount` is always server-recomputed
 * from total_pages/copies since a student could otherwise under-report it),
 * a vendor is a trusted role setting the real walk-in price directly - this
 * `amount` IS trusted as given.
 */
export class CreateCounterEntryDto {
  @IsString()
  @MaxLength(150)
  requester_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  document?: string;

  // Free-text, matching the design's single "Specification" field
  // (e.g. "B&W · A4 · single side") - a counter job doesn't go through the
  // structured paper_size/color_mode/sides/binding pickers the online form
  // uses, since the vendor is describing it directly.
  @IsOptional()
  @IsString()
  @MaxLength(150)
  specification?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  copies: number;

  @Type(() => Number)
  @IsPositive()
  amount: number;

  // Real Reports "Collection by mode" data source — the vendor states how
  // the walk-in payment was actually settled (an online order's mode is
  // always 'online', set server-side in createOrder, never client-supplied).
  @IsIn(PAYMENT_MODES)
  payment_mode: (typeof PAYMENT_MODES)[number];
}
