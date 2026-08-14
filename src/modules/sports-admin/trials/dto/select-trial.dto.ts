import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SelectTrialDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  recommendation?: string;
}
