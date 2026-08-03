import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAlumniProfileDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  personal_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  personal_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  current_company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  designation?: string;
}
