import { IsEnum, IsOptional, IsString } from 'class-validator';
import { sports_equipment_status_enum } from 'generated/prisma/client';

export class SearchEquipmentDto {
  @IsOptional()
  @IsEnum(sports_equipment_status_enum)
  status?: sports_equipment_status_enum;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
