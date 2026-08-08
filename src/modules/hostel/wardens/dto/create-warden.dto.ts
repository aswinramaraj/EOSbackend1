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

export enum HostelWardenRole {
  super_warden = 'super_warden',
  sub_warden = 'sub_warden',
}

export class CreateWardenDto {
  @IsOptional()
  @IsInt()
  user_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  emp_id: string;

  @IsEnum(HostelWardenRole)
  role: HostelWardenRole;

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
