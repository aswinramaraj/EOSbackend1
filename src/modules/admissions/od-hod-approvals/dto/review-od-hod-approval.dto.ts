import { IsIn } from 'class-validator';

/** PATCH /me/od-hod-approvals/:id (HoD only). */
export class ReviewOdHodApprovalDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
