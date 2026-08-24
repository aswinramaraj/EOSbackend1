import { IsIn } from 'class-validator';

export class QueryHodApprovalsDto {
  @IsIn(['student', 'faculty'])
  audience!: 'student' | 'faculty';

  @IsIn(['pending', 'approved', 'rejected', 'all'])
  tab!: 'pending' | 'approved' | 'rejected' | 'all';
}

export class DecideHodApprovalDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';
}
