import { IsIn, IsOptional } from 'class-validator';

export class ExportFormatQueryDto {
  @IsOptional()
  @IsIn(['pdf', 'excel'])
  format?: 'pdf' | 'excel';
}
