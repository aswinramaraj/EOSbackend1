import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { student_leave_status_enum } from 'generated/prisma/client';

// The full student_leave_status_enum includes faculty_approved/hod_approved
// too - those never occur on a routed_to_warden=true row (the where clause
// in LeaveRequestsService always ANDs routed_to_warden: true), so accepting
// them here is harmless; just mirrors GetLeavesDto's own validation instead
// of introducing a second, narrower enum for the same column.
const VALID_STATUSES = Object.values(student_leave_status_enum);

export class SearchLeaveRequestsDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid leave status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: student_leave_status_enum;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  hostel_id?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
