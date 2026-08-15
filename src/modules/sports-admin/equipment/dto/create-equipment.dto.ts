import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { sports_equipment_status_enum } from 'generated/prisma/client';

export class CreateEquipmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  total_quantity?: number;

  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorder_level?: number;

  @IsOptional()
  @IsEnum(sports_equipment_status_enum)
  status?: sports_equipment_status_enum;
}
