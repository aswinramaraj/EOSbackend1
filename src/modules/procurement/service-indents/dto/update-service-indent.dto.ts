import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateServiceIndentDto {
  @ValidateIf((dto) => dto.requested_by_user_id !== undefined)
  @IsInt()
  requested_by_user_id?: number;

  @ValidateIf((dto) => dto.department_id !== undefined)
  @IsInt()
  department_id?: number;

  @ValidateIf((dto) => dto.service_description !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  service_description?: string;
}
