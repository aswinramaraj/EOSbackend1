import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /me/faculty-od — filters, layered on the project's shared pagination
 * convention. `faculty_id` is only honored for HoD/HR Payroll/IQAC callers -
 * a FACULTY caller is always force-scoped to their own records regardless of
 * what they pass here (see FacultyOdService.findAll). department_id/from/to/
 * verification_status are IQAC admin-portal filters, meaningless for the
 * other roles (HoD/HR Payroll already see everyone; Faculty sees only
 * themselves).
 */
export class ListFacultyOdQueryDto extends PaginationDto {
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
  @IsIn(['awaiting_documents', 'under_review', 'verified'])
  verification_status?: 'awaiting_documents' | 'under_review' | 'verified';

  /**
   * A HoD (or HR Payroll/IQAC) is also, personally, a faculty member who can
   * raise their own OD requests through the same self-service screen every
   * other faculty uses. Without this flag that screen's "my own requests"
   * list is indistinguishable from this same caller's approval queue -
   * both hit this endpoint with no other differentiating param, and the
   * default per-role scoping below (department-wide for HoD, HoD-approved
   * only for HR Payroll) is right for the review screens but wrong for the
   * self-service one. mine=true forces "requests I personally raised as
   * faculty_id = me", overriding that default - see FacultyOdService.findAll.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;
}
