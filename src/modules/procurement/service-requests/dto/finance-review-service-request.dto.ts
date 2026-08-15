import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH /me/service-requests/:id/finance-review — mirrors FinanceReviewPurchaseRequestDto exactly. */
export class FinanceReviewServiceRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
