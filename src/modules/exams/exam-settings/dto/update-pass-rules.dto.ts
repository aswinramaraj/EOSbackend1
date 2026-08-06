import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdatePassRulesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'internal_max_marks must be a number' })
  @Min(0)
  internal_max_marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'external_max_marks must be a number' })
  @Min(0)
  external_max_marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'pass_mark_total must be a number' })
  @Min(0)
  pass_mark_total?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'min_external_marks must be a number' })
  @Min(0)
  min_external_marks?: number;
}
