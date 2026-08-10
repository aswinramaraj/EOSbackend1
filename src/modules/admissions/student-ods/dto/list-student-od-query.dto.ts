import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { approval_status_enum } from '../../../../../generated/prisma/enums';

/**
 * GET /me/student-ods (Faculty only, for now) — the calling faculty's
 * mentor-review queue: every od_request whose TEAM CREATOR is a student in
 * a class this faculty mentors (via class_mentors), across all statuses
 * unless filtered. Scoped by the creator's class only - od_requests.
 * mentor_approval_status is one value per request, not per team member, so
 * (unlike the per-member od_request_hod_approvals fan-out) there is exactly
 * one mentor gate per request, tied to whoever created the team.
 */
export class ListStudentOdQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(approval_status_enum)
  status?: approval_status_enum;
}
