import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { HostelWardenRole } from './create-warden.dto';

export class UpdateWardenDto {
  @IsOptional()
  @IsInt()
  user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emp_id?: string;

  @IsOptional()
  @IsEnum(HostelWardenRole)
  role?: HostelWardenRole;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @IsInt()
  block_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsDateString()
  joined_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  quarters?: string;
}
