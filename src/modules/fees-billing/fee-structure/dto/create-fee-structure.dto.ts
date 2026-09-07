import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { fee_structure_applies_to_enum } from '../../../../../generated/prisma/client';
import { CreateFeeStructureItemDto } from './create-fee-structure-item.dto';

export class CreateFeeStructureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsEnum(fee_structure_applies_to_enum)
  applies_to: fee_structure_applies_to_enum;

  @IsOptional()
  @IsInt()
  quota_id?: number;

  @IsString()
  @IsNotEmpty()
  academic_year: string;

  /**
   * Universal — applies to every student demanded against this one
   * structure, not set per student. Optional: an undated structure keeps
   * working exactly as before, simply never triggers a reminder.
   */
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateFeeStructureItemDto)
  items: CreateFeeStructureItemDto[];
}
