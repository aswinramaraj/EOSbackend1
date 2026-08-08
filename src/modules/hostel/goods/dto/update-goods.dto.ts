import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateGoodsDto {
  @IsOptional()
  @IsDateString()
  req_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  item?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;

  @IsOptional()
  @IsInt()
  warden_id?: number;

  @IsOptional()
  @IsInt()
  block_id?: number;

  @IsOptional()
  @IsBoolean()
  received?: boolean;
}
