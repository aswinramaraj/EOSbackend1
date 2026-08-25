import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class BillItemDto {
  @IsIn(['medicine', 'service'])
  item_type!: 'medicine' | 'service';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stock_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rate!: number;
}

/** POST /me/medical-centre-billing — line items stay structured (never flattened into a string). */
export class CreateBillDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  patient_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  patient_dept?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  condition?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  attended_by_staff_id?: number;

  /**
   * The OPD visit this bill settles, when the patient was pulled from the
   * queue. `medical_visits` already knows whether they are a student or a
   * faculty member, so the receipt resolves the real name, roll number / staff
   * code and department through it instead of trusting the free-text
   * patient_name (which matched 5-7 different students in practice).
   *
   * Optional: a walk-in billed without a queue entry has no visit, and the
   * receipt falls back to the typed patient details.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  visit_id?: number;

  @IsIn(['cash', 'upi', 'student_account', 'staff_welfare'])
  payment_mode!: 'cash' | 'upi' | 'student_account' | 'staff_welfare';

  @IsIn(['paid', 'pending', 'settled'])
  status!: 'paid' | 'pending' | 'settled';

  /**
   * The UPI reference for the settlement, printed on the receipt.
   *
   * Required when — and only when — payment_mode is 'upi': a cash or welfare
   * bill has no transaction to reference, so sending one there is rejected
   * rather than silently stored against a payment that never went through a
   * payment rail.
   */
  @ValidateIf((d: CreateBillDto) => d.payment_mode === 'upi')
  @IsString()
  @IsNotEmpty({ message: 'A UPI payment needs its transaction ID' })
  @MaxLength(60)
  upi_transaction_id?: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items!: BillItemDto[];
}
