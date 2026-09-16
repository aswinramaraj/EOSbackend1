import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title?: string;
}
