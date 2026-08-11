import { IsIn } from 'class-validator';

/**
 * PATCH /me/student-ods/:id/faculty-approve (Faculty — the mentor of the
 * requesting team's creator only). Mirrors student-leaves'
 * FacultyApproveLeaveDto, except od_requests.mentor_approval_status really
 * does have a bare 'approved' value (approval_status_enum: pending |
 * approved | rejected) - so unlike leave's 'approved' -> 'faculty_approved'
 * remap, `decision` maps 1:1 onto the stored enum here.
 */
export class FacultyApproveOdDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
