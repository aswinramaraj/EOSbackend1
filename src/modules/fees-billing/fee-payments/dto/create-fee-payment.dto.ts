import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { payment_mode_enum } from '../../../../../generated/prisma/client';

export class CreateFeePaymentDto {
  /**
   * Which demand category (fee_structure_item) this payment is for. Must
   * belong to the same fee_structure as the target student_fee_demand_mapping.
   */
  @IsInt()
  fee_structure_item_id: number;

  @IsNumber()
  @IsPositive()
  amount_paid: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  receipt_no: string;

  @IsOptional()
  @IsEnum(payment_mode_enum)
  payment_mode?: payment_mode_enum;

  @IsOptional()
  @IsBoolean()
  is_partial?: boolean;

  /**
   * Accepted for backward compatibility with the existing frontend payload,
   * but never trusted — the server always uses the authenticated caller's
   * id as the collector. See FeePaymentController.create().
   */
  @IsOptional()
  @IsInt()
  collected_by_user_id?: number | null;
}
