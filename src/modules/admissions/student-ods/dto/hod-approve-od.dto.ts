import { IsIn } from 'class-validator';

/**
 * PATCH /me/student-ods/:id/hod-approve (HoD only, for their own
 * department's fan-out row — see od_request_hod_approvals). Mirrors
 * FacultyApproveOdDto's shape.
 */
export class HodApproveOdDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
