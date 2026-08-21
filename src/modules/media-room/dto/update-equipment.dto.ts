import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { EQUIPMENT_CATEGORIES, EquipmentCondition, EquipmentStatus } from './equipment-enums';

export class UpdateEquipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  asset_tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsIn(EQUIPMENT_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serial_no?: string;

  @IsOptional()
  @IsEnum(EquipmentCondition)
  condition?: EquipmentCondition;

  @IsOptional()
  @IsEnum(EquipmentStatus)
  status?: EquipmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  checked_out_to?: string;

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

  /** Freeform note appended to the movement log alongside this status change (e.g. "Issued to Vignesh for TechFest coverage"). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  movement_note?: string;
}
