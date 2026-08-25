import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListCertificateRequestsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'ready_to_print', 'printed', 'issued'])
  status?: 'pending' | 'ready_to_print' | 'printed' | 'issued';

  @IsOptional()
  @IsString()
  search?: string;
}
