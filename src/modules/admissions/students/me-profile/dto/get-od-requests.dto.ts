import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Mirrors GetLeavesDto's pagination convention. No status filter - unlike
// student_leaves, od_requests has no single stored status column (it's
// computed from mentor_approval_status + the hod_approvals fan-out, see
// od-status.util.ts), so filtering by the computed overall_status would
// mean pulling every row into memory first anyway; left for the client to
// filter client-side on this endpoint's small per-student result set.
export class GetOdRequestsDto {
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
