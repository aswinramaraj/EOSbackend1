import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional } from 'class-validator';

/**
 * GET /students/:id/attendance-summary (Admin).
 *
 * Unlike GetAttendanceDto (the self-scoped /me/attendance sibling), from/to
 * are both optional here: an admin looking up a student's overall attendance
 * to date has no natural default range, so omitting both means "all records
 * on file" rather than a required-but-arbitrary window.
 */
export class AdminAttendanceSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subject_id?: number;
}
