import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /me/purchase-requests/:id/finance-review (Finance only, only while
 * the underlying proposal is 'hod_approved' - i.e. the HoD has already
 * cleared it). On 'approved' -> 'finance_approved' (ready for Admin to
 * convert into a purchase_orders record - see
 * PurchaseRequestsService.convert()); on 'rejected' -> 'rejected',
 * terminal.
 */
export class FinanceReviewPurchaseRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
