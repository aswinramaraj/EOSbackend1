import { IsString, IsIn, MaxLength, ValidateIf } from 'class-validator';

export class DecideApprovalDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  /** Required when rejecting — matches this codebase's own "reason recorded on each" convention for rejections. Optional when approving. */
  @ValidateIf((o: DecideApprovalDto) => o.decision === 'rejected')
  @IsString()
  @MaxLength(255)
  remarks?: string;
}
