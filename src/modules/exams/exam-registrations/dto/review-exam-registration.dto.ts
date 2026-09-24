import { IsIn } from 'class-validator';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

export class ReviewExamRegistrationDto {
  /** 'pending' reopens a previously rejected registration for re-review. */
  @IsIn(['approved', 'rejected', 'pending'])
  status: 'approved' | 'rejected' | 'pending';

  /**
   * Real once `exam_registrations.rejection_reason` runs (see
   * decision_reason_columns.query.md) — kept separate from the existing
   * `reason` column, which is the manual-entry audit justification written
   * once by create() and must never be overwritten by a later reject.
   */
  @OptionalRemarks()
  rejection_reason?: string;
}
