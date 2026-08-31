import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRetrievalDto {
  @IsNotEmpty({ message: 'bundle_or_roll is required' })
  @IsString()
  @MaxLength(60)
  bundle_or_roll: string;

  @IsIn(['photocopy', 'rti'])
  request_type: 'photocopy' | 'rti';

  @IsOptional()
  @IsString()
  @MaxLength(150)
  requester?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  fee_receipt_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fee_receipt_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  purpose?: string;
}
