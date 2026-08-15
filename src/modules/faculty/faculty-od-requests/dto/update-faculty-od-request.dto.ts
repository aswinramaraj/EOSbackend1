import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /faculty-od-requests/:id — HoD, or HR Payroll only.
 *
 * Three independent tracks, each moved by a different role:
 *   - hod_approval_status: HoD only, 'pending' -> 'approved'/'rejected'.
 *   - hr_approval_status: HR Payroll only, requires hod_approval_status
 *     already 'approved' first (mirrors Faculty Leaves).
 *   - verification_status: HR Payroll only — document/geo-tag verification,
 *     independent of the two approval tracks.
 *   - admin_remarks: HoD or HR Payroll, any time, freeform note.
 */
export class UpdateFacultyOdRequestDto {
  @IsOptional()
  @IsIn(['approved', 'rejected'])
  hod_approval_status?: 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['approved', 'rejected'])
  hr_approval_status?: 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['under_review', 'verified'])
  verification_status?: 'under_review' | 'verified';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  admin_remarks?: string;
}
