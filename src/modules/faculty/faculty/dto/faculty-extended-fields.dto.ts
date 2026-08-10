import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Optional faculty fields added alongside the Twilio OTP / attendance work
 * (see TWILIO_VERIFY_INTEGRATION.md and FACULTY_MODULE_UPDATE.md). Shared
 * between CreateFacultyDto and AdminUpdateFacultyDto since both accept the
 * exact same optional set — only the required-field shape differs between
 * "create" and "edit".
 *
 * `@IsIn` lists mirror the frontend's option lists (faculty-wizard-config.ts)
 * for the free-text-but-constrained fields, and the Postgres enum values
 * directly for employment_status/employment_type.
 */
export class FacultyExtendedFieldsDto {
  @IsOptional()
  @IsIn(['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.'])
  prefix?: string;

  @IsOptional()
  @IsIn(['Male', 'Female', 'Other'])
  gender?: string;

  @IsOptional()
  @IsDateString({}, { message: 'date_of_birth must be a valid ISO date' })
  date_of_birth?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid personal email address' })
  personal_email?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'whatsapp_number must be exactly 10 digits' })
  whatsapp_number?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'alternate_phone must be exactly 10 digits' })
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'postal_code must be exactly 6 digits' })
  postal_code?: string;

  @IsOptional()
  @IsIn(['HOD', 'Faculty', 'Class Advisor', 'Coordinator'])
  academic_role?: string;

  @IsOptional()
  @IsIn(['probation', 'confirmed', 'on_leave', 'resigned', 'retired'])
  employment_status?: string;

  @IsOptional()
  @IsIn(['full_time', 'part_time', 'visiting', 'adjunct'])
  employment_type?: string;

  @IsOptional()
  @IsDateString({}, { message: 'confirmation_date must be a valid ISO date' })
  confirmation_date?: string;

  @IsOptional()
  @IsDateString({}, { message: 'probation_end_date must be a valid ISO date' })
  probation_end_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  work_location?: string;

  @IsOptional()
  @IsIn([
    'B.E. / B.Tech',
    'M.E. / M.Tech',
    'Ph.D.',
    'M.Sc.',
    'M.Phil.',
    'Other',
  ])
  qualification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  specialization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  previous_institution?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  previous_experience_years?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  office_room?: string;

  @IsOptional()
  @IsBoolean()
  is_mentor?: boolean;

  @IsOptional()
  @IsBoolean()
  phone_verified?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsapp_verified?: boolean;
}
