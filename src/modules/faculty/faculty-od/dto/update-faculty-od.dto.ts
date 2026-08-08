import { IsIn, IsOptional } from 'class-validator';

/**
 * PATCH /me/faculty-od/:id (HoD or HR Payroll only).
 *
 * Not PartialType(CreateFacultyOdDto) - there is no combined `status` or
 * remarks column on faculty_od_requests, only the two independent
 * hod_approval_status/hr_approval_status enums, same as
 * UpdateFacultyLeafDto. Neither role may reset a value back to 'pending'
 * through this endpoint.
 */
export class UpdateFacultyOdDto {
  @IsOptional()
  @IsIn(['approved', 'rejected'])
  hod_approval_status?: 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['approved', 'rejected'])
  hr_approval_status?: 'approved' | 'rejected';
}
