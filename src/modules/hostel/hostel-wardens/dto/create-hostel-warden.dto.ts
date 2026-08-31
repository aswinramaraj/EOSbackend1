import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { hostel_warden_role_enum } from 'generated/prisma/enums';

export class CreateHostelWardenDto {
  @IsInt()
  block_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  emp_id: string;

  @IsEnum(hostel_warden_role_enum)
  role: hostel_warden_role_enum;

  /** Links this roster entry to a real login account — e.g. so hostel announcements/complaints they post resolve to this warden name instead of a raw email. Optional: a roster entry can exist purely for the goods-request log without ever logging in. */
  @IsOptional()
  @IsInt()
  user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

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
