import { IsOptional, IsString } from 'class-validator';

export class DecideRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
