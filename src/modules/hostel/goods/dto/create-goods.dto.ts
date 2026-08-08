import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateGoodsDto {
  @IsOptional()
  @IsDateString()
  req_date?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  location: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  item: string;

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
