import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class EnterScriptMarkDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  dummy_number: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  part_a_marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  part_b_marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  part_c_marks?: number;

  @IsOptional()
  @IsBoolean()
  is_absent?: boolean;
}
