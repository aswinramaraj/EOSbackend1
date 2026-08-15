import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

const RELATIONS = ['mou_active', 'regular', 'national', 'affiliating', 'new'] as const;

/** POST /me/higher-education-universities — applied/admits/funded are the coordinator's own typed-in counts, not derived from aspirant rows. */
export class CreateUniversityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  programmes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  applied_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  admits_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  funded_count?: number;

  @IsOptional()
  @IsIn(RELATIONS)
  relation?: (typeof RELATIONS)[number];
}
