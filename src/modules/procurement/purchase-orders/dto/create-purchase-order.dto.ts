import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePurchaseOrderDto {
  @IsInt()
  proposal_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  po_number: string;

  @IsOptional()
  @IsInt()
  approved_by_user_id?: number;

  @IsOptional()
  @IsDateString()
  approved_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  file_url?: string;

  @IsOptional()
  @IsDateString()
  sent_to_vendor_at?: string;
}
