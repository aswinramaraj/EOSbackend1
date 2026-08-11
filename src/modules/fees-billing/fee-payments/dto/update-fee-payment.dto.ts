import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateFeePaymentDto } from './create-fee-payment.dto';

/**
 * receipt_no and is_partial are not present on CreateFeePaymentDto (both are
 * server-derived on create), but remain editable here — correcting an
 * existing payment's receipt number or partial flag is a legitimate admin
 * operation, unrelated to the create-time restriction.
 */
export class UpdateFeePaymentDto extends PartialType(CreateFeePaymentDto) {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  receipt_no?: string;

  @IsOptional()
  @IsBoolean()
  is_partial?: boolean;
}
