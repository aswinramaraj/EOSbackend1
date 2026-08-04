import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePurchaseIndentDto {
  @IsInt()
  requested_by_user_id: number;

  @IsInt()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  item_name: string;

  @IsInt()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;
}
