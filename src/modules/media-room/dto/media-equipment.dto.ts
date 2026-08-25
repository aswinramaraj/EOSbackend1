import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * These columns are VarChar rather than Postgres enums, so the allowed values
 * are enforced here — without this a typo would be stored and then fail to
 * match anything the UI can render.
 */
export const EQUIPMENT_CATEGORIES = [
  'camera',
  'lens',
  'support',
  'audio',
  'lighting',
  'aerial',
] as const;

export const EQUIPMENT_CONDITIONS = ['good', 'fair', 'needs_repair'] as const;

export const EQUIPMENT_STATUSES = [
  'available',
  'checked_out',
  'in_service',
  'retired',
] as const;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** Empty string from an untouched form field means "not provided", not "". */
const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

export class CreateEquipmentDto {
  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(30)
  asset_tag?: string;

  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsIn(EQUIPMENT_CATEGORIES)
  category: (typeof EQUIPMENT_CATEGORIES)[number];

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(100)
  serial_no?: string;

  @IsOptional()
  @IsDateString({}, { message: 'purchased_on must be a date (YYYY-MM-DD)' })
  purchased_on?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  invoice_value?: number;

  @IsOptional()
  @IsDateString({}, { message: 'warranty_till must be a date (YYYY-MM-DD)' })
  warranty_till?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEquipmentDto {
  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(30)
  asset_tag?: string;

  @IsOptional()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsIn(EQUIPMENT_CATEGORIES)
  category?: (typeof EQUIPMENT_CATEGORIES)[number];

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(100)
  serial_no?: string;

  @IsOptional()
  @IsIn(EQUIPMENT_CONDITIONS)
  condition?: (typeof EQUIPMENT_CONDITIONS)[number];

  @IsOptional()
  @IsIn(EQUIPMENT_STATUSES)
  status?: (typeof EQUIPMENT_STATUSES)[number];

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(150)
  checked_out_to?: string;

  @IsOptional()
  @IsDateString({}, { message: 'purchased_on must be a date (YYYY-MM-DD)' })
  purchased_on?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  invoice_value?: number;

  @IsOptional()
  @IsDateString({}, { message: 'warranty_till must be a date (YYYY-MM-DD)' })
  warranty_till?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Free-text line appended to the item's movement history alongside this
   * edit, so a check-out or repair is traceable rather than only visible as a
   * changed status.
   */
  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  movement_note?: string;
}

/** Reserved for a future paginated inventory view; the UI lists in full today. */
export class ListEquipmentQueryDto {
  @IsOptional()
  @IsIn(EQUIPMENT_STATUSES)
  status?: (typeof EQUIPMENT_STATUSES)[number];

  @IsOptional()
  @IsIn(EQUIPMENT_CATEGORIES)
  category?: (typeof EQUIPMENT_CATEGORIES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
