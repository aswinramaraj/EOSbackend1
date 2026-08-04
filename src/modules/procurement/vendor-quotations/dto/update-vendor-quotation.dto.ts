import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateVendorQuotationDto {
  @ValidateIf((dto) => dto.vendor_id !== undefined)
  @IsInt()
  vendor_id?: number;

  @ValidateIf((dto) => dto.item_description !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  item_description?: string;

  @ValidateIf((dto) => dto.quoted_price !== undefined)
  @IsNumber()
  quoted_price?: number;
}
