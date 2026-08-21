import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  profile_info?: string;

  // industry/location/recruiter_spoc/expected_package_lpa are real once
  // query.md #13 runs (`companies` gets the columns) — until then these are
  // accepted but silently dropped by the $queryRaw fallback in the service.
  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  recruiter_spoc?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  expected_package_lpa?: number;
}
