import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength, ValidateNested } from 'class-validator';

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

  @IsIn(['cash', 'upi', 'student_account', 'staff_welfare'])
  payment_mode!: 'cash' | 'upi' | 'student_account' | 'staff_welfare';

  @IsIn(['paid', 'pending', 'settled'])
  status!: 'paid' | 'pending' | 'settled';

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items!: BillItemDto[];
}
