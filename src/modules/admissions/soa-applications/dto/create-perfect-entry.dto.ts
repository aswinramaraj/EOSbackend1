import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  student_type_enum,
  dayscholar_mode_enum,
} from 'generated/prisma/client';

/**
 * The spec's example uses dayscholar_mode "college_transport", but the real
 * `dayscholar_mode_enum` (prisma/schema.prisma) is `transport` | `own_vehicle`.
 * Validated against the real values throughout this file and the service.
 */
const VALID_STUDENT_TYPES = Object.values(student_type_enum);
const VALID_DAYSCHOLAR_MODES = Object.values(dayscholar_mode_enum);

const MOBILE_PATTERN = /^\d{10}$/;
// Best-effort interim formats — todo.md explicitly marks the exact regex as
// "Pending from Backend Implementation" (same note given for faculty).
const AADHAR_PATTERN = /^\d{4}-?\d{4}-?\d{4}$/;
const PAN_PATTERN = /^[A-Za-z]{5}\d{4}[A-Za-z]$/;

export class SensitiveInfoDto {
  @IsOptional()
  @Matches(AADHAR_PATTERN, {
    message: 'aadhar_number must be a 12-digit Aadhar number',
  })
  aadhar_number?: string;

  @IsOptional()
  @Matches(PAN_PATTERN, {
    message: 'pan_number must be a valid PAN (e.g. ABCDE5678F)',
  })
  pan_number?: string;
}

export class IdentityMarkDto {
  @IsIn([1, 2], { message: 'mark_number must be 1 or 2' })
  mark_number: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class FamilyDetailsDto {
  @IsOptional() @IsString() @MaxLength(150) father_name?: string;
  @IsOptional() @IsString() @MaxLength(150) father_qualification?: string;
  @IsOptional() @IsString() @MaxLength(150) father_occupation?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  father_annual_income?: number;
  @IsOptional()
  @IsEmail({}, { message: 'father_email must be a valid email' })
  father_email?: string;
  @IsOptional()
  @Matches(MOBILE_PATTERN, {
    message: 'father_mobile must be exactly 10 digits',
  })
  father_mobile?: string;

  @IsOptional() @IsString() @MaxLength(150) mother_name?: string;
  @IsOptional() @IsString() @MaxLength(150) mother_qualification?: string;
  @IsOptional() @IsString() @MaxLength(150) mother_occupation?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  mother_annual_income?: number;
  @IsOptional()
  @IsEmail({}, { message: 'mother_email must be a valid email' })
  mother_email?: string;
  @IsOptional()
  @Matches(MOBILE_PATTERN, {
    message: 'mother_mobile must be exactly 10 digits',
  })
  mother_mobile?: string;
}

export class PerfectEntryContactsDto {
  @IsOptional()
  @IsEmail({}, { message: 'student_email1 must be a valid email' })
  student_email1?: string;
  @IsOptional()
  @IsEmail({}, { message: 'student_email2 must be a valid email' })
  student_email2?: string;
  @IsOptional()
  @Matches(MOBILE_PATTERN, {
    message: 'student_mobile must be exactly 10 digits',
  })
  student_mobile?: string;
}

/**
 * address_type is checked for "present and a string" here only; real
 * `address_type_enum` membership (permanent | temporary) is checked in
 * SoaApplicationsService, same pattern as PUT /me/profile.
 */
export class PerfectEntryAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'address_type is required for each address entry' })
  address_type: string;

  @IsOptional() @IsString() @MaxLength(500) address_line?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(15) pincode?: string;
}

/**
 * One row of the wizard's document checklist. file_url is always a value
 * this same application already got back from POST :id/documents — never
 * accepted as an arbitrary client-supplied URL for anything else, same
 * discipline as ProfileService.uploadResume. is_available can be true with
 * no file_url (collected but not yet scanned) — the two are separate facts,
 * per the reference form's own doc comment on this checklist.
 */
export class PerfectEntryCertificateDto {
  @IsInt()
  certificate_type_id: number;

  @IsBoolean()
  is_available: boolean;

  @IsOptional() @IsString() @MaxLength(500) file_url?: string;
}

/**
 * Only the genuinely unconditional top-level fields are strictly required
 * here (email, course_id, quota_id, batch_id, student_id_no, student_type).
 * Every conditionally-required field (dayscholar_mode, vehicle_number,
 * transport_stage_id, hostel_room_type_id, exserviceman_info,
 * diff_abled_info) is intentionally left @IsOptional() at this layer —
 * their presence is a BUSINESS rule, not a shape rule, and is enforced in
 * SoaApplicationsService as 422 MISSING_CONDITIONAL_FIELD (a distinct
 * errorCode the global ValidationPipe can't produce). This mirrors the same
 * DTO/service split used for cutoff ranges and status transitions in the
 * previous two SOA endpoints.
 */
export class CreatePerfectEntryDto {
  @IsEmail({}, { message: 'email must be a valid email' })
  email: string;

  // Optional: the "Auto-generate" toggle on the wizard's Identity step lets
  // the admin skip typing one — omit this field entirely and the service
  // generates a random 6-digit numeric code instead (see
  // SoaApplicationsService.generateNumericPassword). Either way it's hashed
  // with the same scheme AuthService checks at login (see hashPassword()),
  // and the plaintext is returned once in this endpoint's response so the
  // admin can see/copy it — the SMS to the student's phone (see
  // SmsService) is best-effort, not guaranteed, since no provider is wired
  // up yet.
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'password must be at least 6 characters' })
  @MaxLength(72)
  password?: string;

  @IsInt()
  course_id: number;

  @IsInt()
  quota_id: number;

  @IsInt()
  batch_id: number;

  @IsString()
  @IsNotEmpty({ message: 'student_id_no is required' })
  @MaxLength(30)
  student_id_no: string;

  @IsOptional() @IsString() @MaxLength(20) roll_no?: string;
  @IsOptional() @IsString() @MaxLength(30) register_no?: string;
  @IsOptional() @IsString() @MaxLength(30) admission_no?: string;

  @IsOptional() @IsDateString() admission_date?: string;
  @IsOptional() @IsString() @MaxLength(50) admission_type?: string;
  @IsOptional() @IsString() @MaxLength(20) joined_academic_year?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsDateString() date_of_birth?: string;

  @IsIn(VALID_STUDENT_TYPES, {
    message: `student_type must be one of: ${VALID_STUDENT_TYPES.join(', ')}`,
  })
  student_type: student_type_enum;

  @IsOptional()
  @IsIn(VALID_DAYSCHOLAR_MODES, {
    message: `dayscholar_mode must be one of: ${VALID_DAYSCHOLAR_MODES.join(', ')}`,
  })
  dayscholar_mode?: dayscholar_mode_enum;

  @IsOptional() @IsString() @MaxLength(30) vehicle_number?: string;
  @IsOptional() @IsInt() transport_stage_id?: number;
  @IsOptional() @IsInt() hostel_room_type_id?: number;

  @IsOptional() @IsBoolean() is_first_graduate?: boolean;
  @IsOptional() @IsString() @MaxLength(50) nationality?: string;
  @IsOptional() @IsString() @MaxLength(50) religion?: string;
  @IsOptional() @IsString() @MaxLength(50) community?: string;
  @IsOptional() @IsString() @MaxLength(50) caste?: string;
  @IsOptional() @IsString() @MaxLength(50) mother_tongue?: string;
  @IsOptional() @IsString() @MaxLength(10) blood_group?: string;

  @IsOptional() @IsBoolean() is_father_exserviceman?: boolean;
  @IsOptional() @IsString() @MaxLength(255) exserviceman_info?: string;
  @IsOptional() @IsBoolean() is_diff_abled?: boolean;
  @IsOptional() @IsString() @MaxLength(255) diff_abled_info?: string;

  @IsOptional() @IsString() @MaxLength(50) counselling_order_no?: string;
  @IsOptional() @IsString() @MaxLength(50) counselling_rank_no?: string;
  @IsOptional() @IsString() @MaxLength(50) govt_quota_admission_no?: string;
  @IsOptional() @IsString() @MaxLength(100) joined_through?: string;
  @IsOptional() @IsString() @MaxLength(100) knew_institution_by?: string;
  @IsOptional() @IsString() @MaxLength(150) nominee?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SensitiveInfoDto)
  sensitive_info?: SensitiveInfoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdentityMarkDto)
  identity_marks?: IdentityMarkDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FamilyDetailsDto)
  family_details?: FamilyDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfectEntryContactsDto)
  contacts?: PerfectEntryContactsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerfectEntryAddressDto)
  addresses?: PerfectEntryAddressDto[];

  // Always a URL this same application already got back from
  // POST :id/photo — see PerfectEntryCertificateDto's docblock for why.
  @IsOptional() @IsString() @MaxLength(500) photo_url?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerfectEntryCertificateDto)
  certificates?: PerfectEntryCertificateDto[];
}
