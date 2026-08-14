import { IsIn } from 'class-validator';

/**
 * PATCH /me/campus-outing-requests/:id/faculty-approve (Faculty — the
 * student's mentor only). Same decision shape as FacultyApproveLeaveDto:
 * 'approved' -> status becomes 'faculty_approved' (never a bare
 * 'approved' — that enum value doesn't exist), 'rejected' -> 'rejected'.
 */
export class FacultyApproveOutingRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
