import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDriveDto {
  @IsInt()
  @IsPositive()
  company_id: number;

  @IsDateString()
  scheduled_date: string;

  /** Defaults to true (schema default) — the company name is visible to students immediately. */
  @IsOptional()
  @IsBoolean()
  is_disclosed?: boolean;

  /** Required when is_disclosed is false — the date the company name becomes visible to students. */
  @IsOptional()
  @IsDateString()
  disclosed_reveal_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  job_role?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  package_lpa?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  eligibility_cgpa?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  @IsOptional()
  @IsDateString()
  registration_start?: string;

  @IsOptional()
  @IsDateString()
  registration_end?: string;
}
