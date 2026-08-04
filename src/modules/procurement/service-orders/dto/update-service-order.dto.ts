import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateServiceOrderDto {
  @ValidateIf((dto) => dto.proposal_id !== undefined)
  @IsInt()
  proposal_id?: number;

  @ValidateIf((dto) => dto.so_number !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  so_number?: string;

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
