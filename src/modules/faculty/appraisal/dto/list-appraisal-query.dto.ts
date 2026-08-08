import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /appraisal — filters, layered on the project's shared pagination
 * convention. `faculty_id` is only honored for HoD/HR Payroll callers — a
 * FACULTY caller is always force-scoped to their own records (see
 * AppraisalService.findAll).
 */
export class ListAppraisalQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  faculty_id?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academic_year must be in the format YYYY-YYYY, e.g. 2025-2026',
  })
  academic_year?: string;

  @IsOptional()
  @IsIn([
    'submitted',
    'hod_reviewed',
    'hr_scored',
    'management_approved',
    'rejected',
  ])
  status?: string;
}
