import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

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
}
