import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdatePassRulesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  internal_max_marks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  external_max_marks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pass_mark_total?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_external_marks?: number;
}
