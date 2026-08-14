import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { student_leave_status_enum } from 'generated/prisma/client';

/**
 * The spec's example uses "approved"/"rejected" as if they were the enum
 * values, but the real `student_leave_status_enum` (prisma/schema.prisma) is
 * pending | faculty_approved | hod_approved | rejected. Validated against
 * the real values.
 */
const VALID_STATUSES = Object.values(student_leave_status_enum);

export class GetLeavesDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid leave status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: student_leave_status_enum;

  /**
   * Lets a caller ask for just the academic-tab leaves (false) or just the
   * hostel-tab ones (true) - without this, GET /me/leaves returns both
   * kinds mixed together, same as before this filter existed.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  routed_to_warden?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
