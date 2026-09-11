import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * POST /hr/requests (HR Payroll only) — HR recording a leave/OD entry
 * directly on a faculty member's behalf (e.g. from the Vacation Management
 * calendar), bypassing the normal self-service + HOD/HR approval flow since
 * HR is entering an already-known absence rather than routing a new request
 * through review. Accepts a real from/to range (a single day is just
 * from_date === to_date) — mirrors CreateFacultyLeafDto's own from/to shape.
 */
export class CreateHrVacationEntryDto {
  @IsInt()
  faculty_id: number;

  @IsIn(['leave', 'od'])
  kind: 'leave' | 'od';

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from_date must be in YYYY-MM-DD format',
  })
  from_date: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to_date must be in YYYY-MM-DD format',
  })
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  /** Only meaningful when kind is 'leave' — FK into leave_types, ignored for 'od'. */
  @IsOptional()
  @IsInt()
  leave_type_id?: number;
}
