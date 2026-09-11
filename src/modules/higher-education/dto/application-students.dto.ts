import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const APPLICATION_STUDENT_STATUSES = [
  'applied',
  'selected',
  'rejected',
  'withdrawn',
] as const;

export type ApplicationStudentStatus =
  (typeof APPLICATION_STUDENT_STATUSES)[number];

const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

/**
 * Adds a student to an application window.
 *
 * Either `student_id` or `register_no` identifies them — the picker sends the
 * id it already has, while a typed-in register number is also accepted so the
 * coordinator is not forced through the search when they know the number.
 */
export class AddApplicationStudentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(30)
  register_no?: string;

  @IsOptional()
  @IsIn(APPLICATION_STUDENT_STATUSES)
  status?: ApplicationStudentStatus;

  @IsOptional()
  @IsDateString({}, { message: 'applied_on must be a date (YYYY-MM-DD)' })
  applied_on?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

/** Moves a listed student between Applied / Selected / Rejected / Withdrawn. */
export class UpdateApplicationStudentDto {
  @IsOptional()
  @IsIn(APPLICATION_STUDENT_STATUSES)
  status?: ApplicationStudentStatus;

  @IsOptional()
  @IsDateString({}, { message: 'applied_on must be a date (YYYY-MM-DD)' })
  applied_on?: string;

  @IsOptional()
  @IsDateString({}, { message: 'decided_on must be a date (YYYY-MM-DD)' })
  decided_on?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

/** Adds a student to a test's register. */
export class AddTestStudentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(30)
  register_no?: string;

  @IsOptional()
  @IsDateString({}, { message: 'enrolled_on must be a date (YYYY-MM-DD)' })
  enrolled_on?: string;
}

/**
 * Advances a student through Enrolled -> Attempted -> Cleared.
 *
 * The stages are dates rather than one status value, so a record keeps *when*
 * each step happened. The database also refuses a cleared date with no attempt
 * and any out-of-order pair, so a mistyped date is caught at entry.
 */
export class UpdateTestStudentDto {
  @IsOptional()
  @IsDateString({}, { message: 'enrolled_on must be a date (YYYY-MM-DD)' })
  enrolled_on?: string;

  @IsOptional()
  @IsDateString({}, { message: 'attempted_on must be a date (YYYY-MM-DD)' })
  attempted_on?: string;

  @IsOptional()
  @IsDateString({}, { message: 'cleared_on must be a date (YYYY-MM-DD)' })
  cleared_on?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(50)
  score?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

/** Student picker query for both "add student" flows. */
export class SearchStudentsQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Type at least 2 characters to search' })
  @MaxLength(80)
  q: string;
}
