import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH /me/service-requests/:id/hod-review — mirrors HodReviewPurchaseRequestDto exactly. */
export class HodReviewServiceRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
