import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const INDENT_TYPES = [
  'capital_equipment',
  'consumables',
  'repair_service',
  'rental_hire',
] as const;

export const BUDGET_HEADS = [
  'media_branding',
  'institution_events',
  'admissions_outreach',
] as const;

export const INDENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'fulfilled',
] as const;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

export class CreateIndentDto {
  @trim
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsIn(INDENT_TYPES)
  indent_type?: (typeof INDENT_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimated_cost?: number;

  @IsOptional()
  @IsDateString({}, { message: 'needed_by must be a date (YYYY-MM-DD)' })
  needed_by?: string;

  @IsOptional()
  @IsIn(BUDGET_HEADS)
  budget_head?: (typeof BUDGET_HEADS)[number];

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  justification?: string;
}

/**
 * Status-only transition. `resolution_notes` records why an indent was
 * approved, rejected or closed; the service stamps `resolved_at` so the reason
 * and the moment it was decided cannot drift apart.
 */
export class UpdateIndentDto {
  @IsIn(INDENT_STATUSES)
  status: (typeof INDENT_STATUSES)[number];

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  resolution_notes?: string;
}
