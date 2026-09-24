import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateCanteenSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  gst_percentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  parcel_charge?: number;
}
