import { IsIn } from 'class-validator';

/**
 * PATCH /me/campus-outing-requests/:id/hod-approve (HoD only). Second
 * (final) stage — only valid once the mentor faculty has already set
 * status='faculty_approved'. 'approved' -> 'hod_approved', 'rejected' ->
 * 'rejected'.
 */
export class HodApproveOutingRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
