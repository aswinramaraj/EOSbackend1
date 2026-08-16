import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * POST /me/department-documents (Secretary/Admin/Principal).
 * department_id is client-supplied — Secretary has no structural
 * department link (same convention as CreatePurchaseRequestDto).
 */
export class CreateDocumentDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  file_url?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  size_bytes?: number;
}
