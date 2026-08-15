import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/** POST /me/higher-education-scholarship-schemes — applied/awarded/value are the coordinator's own typed-in counts, not derived from any other table. */
export class CreateSchemeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  scheme_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  applied_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  awarded_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total_value?: number;
}
