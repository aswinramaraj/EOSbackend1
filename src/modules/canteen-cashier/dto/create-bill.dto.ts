import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CreateBillItemDto } from './create-bill-item.dto';

export class CreateBillDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBillItemDto)
  items: CreateBillItemDto[];

  @IsIn(['cash', 'upi'])
  payment_mode: 'cash' | 'upi';

  /**
   * Set only on a resubmit after the server rejected the first attempt for
   * insufficient stock — the cashier saw exactly which items were short and
   * explicitly chose to sell anyway. Never set on a first attempt.
   */
  @IsOptional()
  @IsBoolean()
  force_emergency?: boolean = false;
}
