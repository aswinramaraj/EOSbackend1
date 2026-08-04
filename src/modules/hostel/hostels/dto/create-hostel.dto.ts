import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum HostelWing {
  boys = 'boys',
  girls = 'girls',
}

export class CreateHostelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsEnum(HostelWing)
  wing: HostelWing;

  @IsOptional()
  @IsInt()
  warden_user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mess_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  established_year?: number;
}
