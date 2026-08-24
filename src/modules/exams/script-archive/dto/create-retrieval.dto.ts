import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateRetrievalDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  archive_bundle_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  purpose: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  issued_to?: string;
}
