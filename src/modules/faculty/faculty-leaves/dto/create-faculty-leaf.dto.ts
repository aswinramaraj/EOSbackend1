import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /faculty-leaves (Faculty only).
 *
 * `leave_type_id` is an optional FK into the `leave_types` reference table
 * (Casual/Sick/Earned/etc. — managed directly in the database, not through
 * this API); leaving it unset just means the request has no sub-type.
 *
 * `faculty_id` is never client-supplied, even though the spec's example body
 * includes it — the service derives it from the authenticated faculty
 * (@CurrentUser().sub), same pattern as Attendance/Lesson Plans/LMS Notes,
 * and consistent with "Faculty: POST ... own" in the RBAC section (this is
 * self-service leave application, not applying on someone else's behalf).
 */
export class CreateFacultyLeafDto {
  @IsDateString({}, { message: 'from_date must be a valid ISO date' })
  from_date: string;

  @IsDateString({}, { message: 'to_date must be a valid ISO date' })
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsInt()
  leave_type_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  alternate_arrangement?: string;

  @IsOptional()
  @IsBoolean()
  is_station_leave?: boolean;
}
