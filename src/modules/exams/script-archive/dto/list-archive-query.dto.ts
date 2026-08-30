import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListArchiveQueryDto {
  @IsOptional()
  @IsIn(['in_archive', 'issued_out', 'due_disposal'])
  status?: 'in_archive' | 'issued_out' | 'due_disposal';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  rack?: string;

  @IsOptional()
  @IsIn(['photocopy', 'rti'])
  request_type?: 'photocopy' | 'rti';
}
