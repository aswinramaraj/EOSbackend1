import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCertificateRequestDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  certificate_type_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  fee_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  copies?: number;

  @IsOptional()
  @IsIn(['counter', 'post'])
  delivery_mode?: 'counter' | 'post';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
