import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertHealthRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(5)
  blood_group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  allergies?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  chronic_condition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  guardian_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  guardian_phone?: string;
}
