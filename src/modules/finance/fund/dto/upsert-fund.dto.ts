import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Creates the fund for an academic year, or revises its total.
 *
 * `total_amount` is accepted as a number of rupees with up to 2 decimals and
 * is validated tightly: this is the single input that decides how much money
 * the Finance office is allowed to commit, so it is bounded on both ends
 * rather than trusted. The column is NUMERIC(14,2), i.e. max 12 integer
 * digits, hence the 10^12 ceiling.
 */
export class UpsertFinanceFundDto {
  /** e.g. "2026-27". Fixed shape so a year can never be entered ambiguously. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'academic_year must look like 2026-27',
  })
  academic_year: string;

  @Type(() => Number)
  @IsInt({ message: 'total_amount must be a whole number of rupees' })
  @Min(0)
  @Max(999_999_999_999)
  total_amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  notes?: string;

  /** Locking a year freezes it: the database then refuses further movement. */
  @IsOptional()
  @IsBoolean()
  is_locked?: boolean;

  /**
   * Why the total is being changed. Required by the service on a revision (not
   * on first creation) so every adjustment carries a stated reason into the
   * append-only ledger.
   */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason?: string;
}
