import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum TeamMemberStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  skills?: string;

  @IsOptional()
  @IsString()
  photo_url?: string;

  @IsOptional()
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;
}
