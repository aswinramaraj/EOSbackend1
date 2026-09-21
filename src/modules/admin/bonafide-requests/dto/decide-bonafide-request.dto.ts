import { IsIn } from 'class-validator';
import { OptionalRemarks } from 'src/common/dto/decision-reason.dto';

/** PATCH /admin/bonafide-requests/:id/decision */
export class DecideBonafideRequestDto {
  @IsIn(['approve', 'reject'], {
    message: 'decision must be either approve or reject',
  })
  decision!: 'approve' | 'reject';

  /** Real once decision_reason_columns.query.md's bonafide_requests.rejection_reason runs — accepted but silently dropped by the service's $executeRaw fallback until then. */
  @OptionalRemarks()
  rejection_reason?: string;
}
