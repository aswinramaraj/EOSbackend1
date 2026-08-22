import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * EDC Coordinator's "Add Student" create form. Only `student_id` and
 * `business_name` are required (matching the real student_entrepreneurship
 * schema — every other column is nullable). `student_id` must reference an
 * existing student with no entrepreneurship row yet (student_id is @unique
 * — enforced in the service with a friendly 409, not left to the DB error).
 */
export class CreateStudentEntrepreneurshipDto {
  @IsInt()
  student_id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  business_name!: string;

  @IsOptional()
  @IsString()
  business_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  sector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stage?: string;

  @IsOptional()
  @IsNumber()
  funding_required?: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsIn(['private_limited', 'llp', 'proprietorship', 'unregistered'])
  registration_type?: 'private_limited' | 'llp' | 'proprietorship' | 'unregistered';

  @IsOptional()
  @IsBoolean()
  is_incubated?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;

  @IsOptional()
  @IsInt()
  year_started?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  current_status_note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  business_category?: string;

  @IsOptional()
  @IsString()
  problem_statement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  business_model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  target_customers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  linkedin_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  co_founders?: string;

  @IsOptional()
  @IsInt()
  team_size?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  student_team_note?: string;

  @IsOptional()
  @IsInt()
  mentor_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  external_mentor_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  external_mentor_org?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  team_roles_note?: string;

  @IsOptional()
  @IsBoolean()
  idea_developed?: boolean;

  @IsOptional()
  @IsBoolean()
  prototype_developed?: boolean;

  @IsOptional()
  @IsBoolean()
  mvp_launched?: boolean;

  @IsOptional()
  @IsBoolean()
  product_launched?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  customers_count?: number;

  @IsOptional()
  @IsNumber()
  monthly_revenue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  growth_stage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  funding_status?: string;

  @IsOptional()
  @IsNumber()
  funding_received?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  funding_source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  govt_grant_scheme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  incubator_support?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  accelerator_support?: string;
}
