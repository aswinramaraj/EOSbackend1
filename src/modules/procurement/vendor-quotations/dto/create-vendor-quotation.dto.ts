import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateVendorQuotationDto {
  @IsInt()
  vendor_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  item_description: string;

  @IsNumber()
  quoted_price: number;
}
