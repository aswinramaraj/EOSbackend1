import { IsEnum, IsIn, IsOptional } from 'class-validator';

export enum HostelQuitFeeStatus {
  pending = 'pending',
  completed = 'completed',
}

export class DecideQuitRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsEnum(HostelQuitFeeStatus)
  fee_status?: HostelQuitFeeStatus;
}
