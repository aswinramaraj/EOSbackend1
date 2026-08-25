import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** Empty string from an untouched input means "not provided", not "". */
const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

// ───────────────────────────── pharmacy stock ─────────────────────────────

export class CreateStockItemDto {
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  use_case?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(50)
  form?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorder_level?: number;

  @IsOptional()
  @IsDateString({}, { message: 'expiry_date must be a date (YYYY-MM-DD)' })
  expiry_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate?: number;
}

/**
 * Partial edit of a stock line.
 *
 * `quantity` is editable here for stock-take corrections, which is a different
 * act from dispensing or restocking — those stay on their own endpoints so the
 * dispense log keeps a faithful record of what actually left the counter.
 */
export class UpdateStockItemDto {
  @IsOptional()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  use_case?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(50)
  form?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorder_level?: number;

  @IsOptional()
  @IsDateString({}, { message: 'expiry_date must be a date (YYYY-MM-DD)' })
  expiry_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate?: number;
}

// ─────────────────────────────── equipment ───────────────────────────────

/**
 * The two values the existing toggle-condition endpoint already writes. Kept
 * identical so a record edited here and one toggled there mean the same thing.
 */
export const EQUIPMENT_CONDITIONS = ['working', 'under_service'] as const;

export class CreateMedicalEquipmentDto {
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  quantity?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(150)
  location?: string;

  @IsOptional()
  @IsIn(EQUIPMENT_CONDITIONS)
  condition?: (typeof EQUIPMENT_CONDITIONS)[number];
}

export class UpdateMedicalEquipmentDto {
  @IsOptional()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  quantity?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(150)
  location?: string;

  @IsOptional()
  @IsIn(EQUIPMENT_CONDITIONS)
  condition?: (typeof EQUIPMENT_CONDITIONS)[number];
}

// ───────────────────────────── camps & check-ups ─────────────────────────────

/**
 * Exactly the values medical_camps_state_check permits.
 *
 * There is deliberately no 'completed' here: the table models a finished camp
 * as `is_past` plus an `outcome_summary`, and `is_past` is derived from the
 * camp date rather than typed in, so a camp cannot be marked finished while
 * still being listed as upcoming.
 */
export const CAMP_STATES = ['planning', 'scheduled', 'running'] as const;

export class CreateCampDto {
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @IsDateString({}, { message: 'camp_date must be a date (YYYY-MM-DD)' })
  camp_date: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  detail?: string;

  @IsOptional()
  @IsIn(CAMP_STATES)
  state?: (typeof CAMP_STATES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  target_count?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  outcome_summary?: string;
}

export class UpdateCampDto {
  @IsOptional()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsDateString({}, { message: 'camp_date must be a date (YYYY-MM-DD)' })
  camp_date?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  detail?: string;

  @IsOptional()
  @IsIn(CAMP_STATES)
  state?: (typeof CAMP_STATES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  target_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  registered_count?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  outcome_summary?: string;
}

// ──────────────────────────────── OPD search ────────────────────────────────

/**
 * OPD patient search. Covers students and staff in one query, because the
 * person at the counter is whoever walked in — the operator should not have to
 * choose which register to look in first.
 */
export class OpdSearchQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Type at least 2 characters to search' })
  @MaxLength(80)
  q: string;

  @IsOptional()
  @IsIn(['student', 'faculty', 'all'])
  kind?: 'student' | 'faculty' | 'all';
}

// ─────────────────────── Camp registrations (roster) ───────────────────────

/**
 * One person on a camp roster. Exactly one of student_id / faculty_id is set —
 * the DB enforces it with a CHECK constraint, and the service rejects a payload
 * carrying both or neither before it ever reaches the insert.
 */
export class AddCampRegistrationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  student_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}

/** Saving the whole selection the Register dialog has built up. */
export class BulkCampRegistrationDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one person to register' })
  @ValidateNested({ each: true })
  @Type(() => AddCampRegistrationDto)
  people: AddCampRegistrationDto[];
}

/** Only the remarks are editable; see the service for why. */
export class UpdateCampRegistrationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}
