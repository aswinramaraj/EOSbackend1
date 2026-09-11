import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DELIVERY_STATUSES = [
  'ordered',
  'dispatched',
  'in_transit',
  'partially_delivered',
  'delivered',
  'cancelled',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Starts tracking an order that Finance has placed with a vendor. */
export class CreateTrackingDto {
  @IsIn(['purchase', 'service'])
  order_kind: 'purchase' | 'service';

  /** The purchase_orders.id or service_orders.id being tracked. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity_ordered?: number;

  @IsOptional()
  @IsDateString({}, { message: 'expected_delivery_date must be a date (YYYY-MM-DD)' })
  expected_delivery_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  tracking_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  remarks?: string;
}

/**
 * Advances the tracking state. Deliberately manual — there is no carrier
 * feed, so staff select the step reached. The database refuses to move a
 * terminal (delivered/cancelled) order back to an in-flight state.
 */
export class UpdateTrackingDto {
  @IsOptional()
  @IsIn(DELIVERY_STATUSES)
  delivery_status?: DeliveryStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity_delivered?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity_ordered?: number;

  @IsOptional()
  @IsDateString({}, { message: 'expected_delivery_date must be a date (YYYY-MM-DD)' })
  expected_delivery_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  tracking_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  remarks?: string;
}

/** Hands a delivered item to a faculty member. */
export class CreateAllotmentDto {
  @Type(() => Number)
  @IsInt({ message: 'faculty_id is required' })
  @Min(1)
  faculty_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  remarks?: string;
}

export class UpdateAllotmentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  faculty_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  remarks?: string;
}

/** Faculty picker query for the allotment step. */
export class FacultySearchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
