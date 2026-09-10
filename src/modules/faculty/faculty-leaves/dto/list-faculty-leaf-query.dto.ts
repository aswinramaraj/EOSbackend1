import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /faculty-leaves — filters, layered on the project's shared pagination
 * convention. `faculty_id` is only honored for HoD/HR Payroll callers — a
 * FACULTY caller is always force-scoped to their own records regardless of
 * what they pass here (see FacultyLeavesService.findAll).
 */
export class ListFacultyLeafQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  faculty_id?: number;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  hod_approval_status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  hr_approval_status?: 'pending' | 'approved' | 'rejected';

  /**
   * A HoD is also, personally, a faculty member who can raise their own
   * leave requests through the same self-service screen every other
   * faculty uses. Without this flag that screen's "my own requests" list
   * is indistinguishable from this same caller's department approval
   * queue - both hit this endpoint with no other differentiating param,
   * and the default HoD scoping below (department-wide) is right for the
   * review screen but wrong for the self-service one. mine=true forces
   * "requests I personally raised as faculty_id = me" - see
   * FacultyLeavesService.findAll.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;
}
