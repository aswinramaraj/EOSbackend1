import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * POST /me/purchase-requests (Secretary only).
 *
 * Backed by the existing purchase_indents + purchase_order_proposals tables
 * (see PurchaseRequestsService) rather than a bespoke table - creating a
 * request here creates one purchase_indents row plus a linked
 * purchase_order_proposals row (vendor_id left null; vendor selection is a
 * separate, later concern handled through the existing Admin-only
 * /purchase-order-proposals endpoint, not part of this self-service flow).
 *
 * department_id is client-supplied rather than resolved from the caller's
 * own profile - a Secretary account has no structural department link (no
 * `non_teaching_staff` row in the actual seed data). Matches
 * CreatePurchaseIndentDto's own existing convention.
 */
export class CreatePurchaseRequestDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  item_name: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsDateString()
  needed_by?: string;
}
