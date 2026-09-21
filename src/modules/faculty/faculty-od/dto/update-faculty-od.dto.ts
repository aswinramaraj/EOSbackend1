import { IsIn, IsOptional } from 'class-validator';

/**
 * PATCH /me/faculty-od/:id (HoD, HR Payroll, or Correspondent).
 *
 * Not PartialType(CreateFacultyOdDto) - there is no combined `status` or
 * remarks column on faculty_od_requests, only the independent
 * hod_approval_status/hr_approval_status/correspondent_approval_status
 * enums, same as UpdateFacultyLeafDto. No role may reset a value back to
 * 'pending' through this endpoint.
 */
export class UpdateFacultyOdDto {
  @IsOptional()
  @IsIn(['approved', 'rejected'])
  hod_approval_status?: 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['approved', 'rejected'])
  hr_approval_status?: 'approved' | 'rejected';

  /** Correspondent only - decides a Principal-authored request. */
  @IsOptional()
  @IsIn(['approved', 'rejected'])
  correspondent_approval_status?: 'approved' | 'rejected';

  @IsOptional()
  correspondent_remarks?: string;
}
