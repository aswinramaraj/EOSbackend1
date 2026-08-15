import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRosterEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  jersey_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  squad_role?: string;
}
