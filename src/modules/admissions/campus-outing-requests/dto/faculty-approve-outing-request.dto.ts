import { IsIn } from 'class-validator';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

/**
 * PATCH /me/campus-outing-requests/:id/faculty-approve (Faculty — the
 * student's mentor only). Same decision shape as FacultyApproveLeaveDto:
 * 'approved' -> status becomes 'faculty_approved' (never a bare
 * 'approved' — that enum value doesn't exist), 'rejected' -> 'rejected'.
 */
export class FacultyApproveOutingRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  /** Real once campus_outing_requests.remarks runs (see decision_reason_columns.query.md). Rejection is terminal at either stage, so one column covers both. */
  @OptionalRemarks()
  remarks?: string;
}
