import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { indent_status_enum } from '../../../../../generated/prisma/client';

export class UpdatePurchaseIndentDto {
  @ValidateIf((dto) => dto.requested_by_user_id !== undefined)
  @IsInt()
  requested_by_user_id?: number;

  @ValidateIf((dto) => dto.department_id !== undefined)
  @IsInt()
  department_id?: number;

  @ValidateIf((dto) => dto.item_name !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  item_name?: string;

  @ValidateIf((dto) => dto.quantity !== undefined)
  @IsInt()
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;

  @ValidateIf((dto) => dto.status !== undefined)
  @IsEnum(indent_status_enum)
  status?: indent_status_enum;
}
