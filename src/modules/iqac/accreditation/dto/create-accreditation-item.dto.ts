import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = ['pending', 'in_progress', 'complete'] as const;

/**
 * The reference design's "Add accreditation item" popup for NAAC/AQAR/SSR
 * progress — a real iqac_accreditation_criteria row (cycle is fixed by the
 * route, not client-supplied). code is derived server-side as
 * "{CYCLE}-C{criterion_number}", matching the mock's own "NAAC-C1" style —
 * not a client-editable field.
 */
export class CreateAccreditationItemDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  criterion_number: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  owner_faculty_id?: number;

  /** Scope — null/omitted = institution-wide ("All"), a real department id = department-scoped. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  readiness_percent?: number;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
