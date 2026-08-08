import { IsIn } from 'class-validator';

/**
 * PATCH /me/product-requests/:id/review (Admin only).
 * Reviews a 'pending' request; the only two outcomes the table's status
 * enum supports beyond pending/draft. `reviewed_by_user_id`/`reviewed_at`
 * are never client-supplied — derived from the JWT and the current time.
 */
export class ReviewProductRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
