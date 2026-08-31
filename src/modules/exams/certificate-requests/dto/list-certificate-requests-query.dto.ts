import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class ListCertificateRequestsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'ready_to_print', 'printed', 'issued'])
  status?: 'pending' | 'ready_to_print' | 'printed' | 'issued';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  certificate_type_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
