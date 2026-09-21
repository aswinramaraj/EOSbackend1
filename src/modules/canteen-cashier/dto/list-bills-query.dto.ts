import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ListBillsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
