import {
  IsBoolean,
  IsDateString,
  IsIn,
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

  // mode/backlogs_allowed/eligible_department_codes/round*_label/
  // result_declaration_note are real once query.md #14 runs
  // (`placement_drives` gets the columns) — until then these are accepted
  // but silently dropped by the $queryRaw fallback in the service.
  @IsOptional()
  @IsIn(['on_campus', 'virtual'])
  mode?: 'on_campus' | 'virtual';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  backlogs_allowed?: string;

  /** Comma-separated department codes, e.g. "CSE,IT,AIDS". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  eligible_department_codes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  round1_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  round2_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  round3_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  result_declaration_note?: string;
}
