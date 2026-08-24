import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsPositive, IsString, MaxLength } from 'class-validator';

export class ArchiveBundleDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  bundle_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  location_label: string;

  @IsDateString()
  retention_until: string;
}
