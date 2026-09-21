import { OptionalRemarks } from 'src/common/dto/decision-reason.dto';

/** PATCH library/borrow-requests/:id/reject */
export class RejectBorrowRequestDto {
  /** Real once decision_reason_columns.query.md's book_borrow_requests.remarks runs — accepted but silently dropped by the service's $executeRaw fallback until then. */
  @OptionalRemarks()
  remarks?: string;
}
