import { IsIn } from 'class-validator';
import { OptionalRemarks } from 'src/common/dto/decision-reason.dto';

export class QueryHodApprovalsDto {
  @IsIn(['student', 'faculty'])
  audience!: 'student' | 'faculty';

  @IsIn(['pending', 'approved', 'rejected', 'all'])
  tab!: 'pending' | 'approved' | 'rejected' | 'all';
}

export class DecideHodApprovalDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  /** Optional free-text reason, shown by the shared ReasonDialog on reject. */
  @OptionalRemarks()
  remarks?: string;
}
