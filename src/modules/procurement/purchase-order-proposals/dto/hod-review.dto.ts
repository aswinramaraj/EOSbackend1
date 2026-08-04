import { IsIn, IsInt } from 'class-validator';
import { proposal_status_enum } from '../../../../../generated/prisma/client';

export class HodReviewDto {
  @IsInt()
  hod_reviewed_by: number;

  @IsIn([proposal_status_enum.hod_approved, proposal_status_enum.rejected])
  status:
    | typeof proposal_status_enum.hod_approved
    | typeof proposal_status_enum.rejected;
}
