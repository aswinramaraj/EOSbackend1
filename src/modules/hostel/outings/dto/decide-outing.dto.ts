import { IsIn } from 'class-validator';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

export class DecideOutingDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  /** Real once hostel_outings.remarks runs (see decision_reason_columns.query.md). Distinct from `reason`, the student's own stated reason for the outing. */
  @OptionalRemarks()
  remarks?: string;
}
