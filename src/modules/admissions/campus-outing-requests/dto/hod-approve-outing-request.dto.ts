import { IsIn } from 'class-validator';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

/**
 * PATCH /me/campus-outing-requests/:id/hod-approve (HoD only). Second
 * (final) stage — only valid once the mentor faculty has already set
 * status='faculty_approved'. 'approved' -> 'hod_approved', 'rejected' ->
 * 'rejected'.
 */
export class HodApproveOutingRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  /** Real once campus_outing_requests.remarks runs (see decision_reason_columns.query.md). Rejection is terminal at either stage, so one column covers both. */
  @OptionalRemarks()
  remarks?: string;
}
