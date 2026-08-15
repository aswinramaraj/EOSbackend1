import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { student_leave_status_enum } from '../../../../../generated/prisma/enums';

/**
 * GET /me/campus-outing-requests (Faculty or HoD) — mirrors
 * ListStudentLeaveQueryDto exactly; campus_outing_requests reuses
 * student_leave_status_enum as-is ('warden_approved' is simply never set
 * on this table).
 */
export class ListCampusOutingRequestsQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(student_leave_status_enum)
  status?: student_leave_status_enum;
}
