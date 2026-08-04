import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEducationLoanDdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  dd_reference_number: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  bank_name: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  acknowledgement_receipt_no?: string;

  @IsOptional()
  @IsInt()
  received_by_user_id?: number;
}
