import { IsIn, IsOptional } from 'class-validator';

/**
 * PATCH /faculty-leaves/:id (HoD or HR Payroll only).
 *
 * Intentionally NOT PartialType(CreateFacultyLeafDto): the spec's boolean
 * hod_approved/hr_approved and combined `status`/`remarks` fields don't exist
 * on the schema. The real, independent columns are hod_approval_status and
 * hr_approval_status (approval_status_enum). An approver moves their own
 * column forward from 'pending' to 'approved' or 'rejected' — never back to
 * 'pending' via this endpoint.
 *
 * Which field a given caller may set is enforced in the service by role:
 * HoD may only set hod_approval_status; HR Payroll may only set
 * hr_approval_status, and only once hod_approval_status is already 'approved'.
 */
export class UpdateFacultyLeafDto {
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
