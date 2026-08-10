import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /hr/requests (HR Payroll only) — HR recording a leave/OD entry
 * directly on a faculty member's behalf (e.g. from the Vacation Management
 * calendar), bypassing the normal self-service + HOD/HR approval flow since
 * HR is entering an already-known, single-day absence rather than routing a
 * new request through review.
 */
export class CreateHrVacationEntryDto {
  @IsInt()
  faculty_id: number;

  @IsIn(['leave', 'od'])
  kind: 'leave' | 'od';

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  /** Only meaningful when kind is 'leave' — FK into leave_types, ignored for 'od'. */
  @IsOptional()
  @IsInt()
  leave_type_id?: number;
}
