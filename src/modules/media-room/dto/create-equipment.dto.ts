import { IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { EQUIPMENT_CATEGORIES, EquipmentCondition, EquipmentStatus } from './equipment-enums';

export class CreateEquipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  asset_tag?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsIn(EQUIPMENT_CATEGORIES)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serial_no?: string;

  @IsOptional()
  @IsDateString()
  purchased_on?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  invoice_value?: number;

  @IsOptional()
  @IsDateString()
  warranty_till?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(EquipmentCondition)
  condition?: EquipmentCondition;

  @IsOptional()
  @IsEnum(EquipmentStatus)
  status?: EquipmentStatus;

  /** Real column, previously only settable via a later PATCH — the design's "Holder / location" field. Only meaningful alongside a non-"available" status. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  checked_out_to?: string;
}
