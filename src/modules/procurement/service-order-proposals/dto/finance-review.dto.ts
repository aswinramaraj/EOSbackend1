import { IsIn, IsInt } from 'class-validator';
import { proposal_status_enum } from '../../../../../generated/prisma/client';

export class FinanceReviewDto {
  @IsInt()
  finance_reviewed_by: number;

  @IsIn([proposal_status_enum.finance_approved, proposal_status_enum.rejected])
  status:
    | typeof proposal_status_enum.finance_approved
    | typeof proposal_status_enum.rejected;
}
