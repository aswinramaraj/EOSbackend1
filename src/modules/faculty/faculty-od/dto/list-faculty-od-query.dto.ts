import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional } from 'class-validator';
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
}
