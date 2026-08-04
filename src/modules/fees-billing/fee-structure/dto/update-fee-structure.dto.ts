import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { fee_structure_applies_to_enum } from '../../../../../generated/prisma/client';

export class UpdateFeeStructureDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsEnum(fee_structure_applies_to_enum)
  applies_to?: fee_structure_applies_to_enum;

  @IsOptional()
  @IsInt()
  quota_id?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  academic_year?: string;
}
