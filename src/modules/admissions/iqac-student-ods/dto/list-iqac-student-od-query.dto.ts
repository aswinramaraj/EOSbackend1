import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /iqac/student-ods (IQAC only). department_id/from/to filter on the
 * requesting team's CREATOR (same convention StudentOdsService uses for its
 * mentor-queue scoping) — a team can have cross-department members, but one
 * primary requester's department is what the admin portal's filter means.
 */
export class ListIqacStudentOdQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsISO8601({}, { message: 'from must be a valid ISO date' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be a valid ISO date' })
  to?: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  mentor_approval_status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['awaiting_documents', 'under_review', 'verified'])
  verification_status?: 'awaiting_documents' | 'under_review' | 'verified';
}
