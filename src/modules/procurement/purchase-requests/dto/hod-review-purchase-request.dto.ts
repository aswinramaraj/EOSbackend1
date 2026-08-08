import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /me/purchase-requests/:id/hod-review (HoD only, own department,
 * only while the underlying proposal is 'pending' - i.e. awaiting its
 * first review). On 'approved' -> proposal status becomes 'hod_approved'
 * (forwarded to Finance, per the requested workflow); on 'rejected' ->
 * 'rejected', terminal - there is no "send back to Secretary for edits"
 * state, matching the same terminal-rejection convention already used for
 * student_leaves/od_requests/appraisal_requests.
 */
export class HodReviewPurchaseRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
