import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /faculty-od-requests — filters, layered on the project's shared
 * pagination convention. `faculty_id` is only honored for HoD/HR Payroll
 * callers — a FACULTY caller is always force-scoped to their own records,
 * and a HOD caller is always force-scoped to their own department (see
 * FacultyOdRequestsService.findAll).
 */
export class ListFacultyOdRequestQueryDto extends PaginationDto {
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
  @IsIn(['awaiting_documents', 'under_review', 'verified'])
  verification_status?: 'awaiting_documents' | 'under_review' | 'verified';
}
