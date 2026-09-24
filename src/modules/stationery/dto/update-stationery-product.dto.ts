import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsBoolean } from 'class-validator';
import { CreateStationeryProductDto } from './create-stationery-product.dto';

export class UpdateStationeryProductDto extends PartialType(CreateStationeryProductDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
