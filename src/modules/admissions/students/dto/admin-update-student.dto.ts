import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';

/**
 * Scoped to the `students` table's own columns only. Updating nested
 * student_contacts/student_family_details/student_sensitive_info is a
 * separate concern — no generic admin endpoint touches those today.
 * student_addresses is the one exception: see PATCH /students/:id/addresses
 * (StudentsService.updateAddresses) for editing those after admission.
 */
export class AdminUpdateStudentDto {
  @IsOptional() @MaxLength(30) roll_no?: string;
  @IsOptional() @MaxLength(30) register_no?: string;
  @IsOptional() @MaxLength(30) admission_no?: string;
  @IsOptional() @IsDateString() admission_date?: string;
  @IsOptional() @MaxLength(50) admission_type?: string;
  @IsOptional() @MaxLength(20) joined_academic_year?: string;
  @IsOptional() @MaxLength(20) gender?: string;
  @IsOptional() @IsDateString() date_of_birth?: string;
  @IsOptional() @IsIn(['hosteller', 'dayscholar']) student_type?:
    'hosteller' | 'dayscholar';
  @IsOptional() @IsIn(['transport', 'own_vehicle']) dayscholar_mode?:
    'transport' | 'own_vehicle';
  @IsOptional() @MaxLength(30) vehicle_number?: string;
  @IsOptional() @IsInt() course_id?: number;
  @IsOptional() @IsInt() quota_id?: number;
  @IsOptional() @IsInt() class_id?: number;
  @IsOptional() @IsInt() batch_id?: number;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @IsOptional() @IsBoolean() is_first_graduate?: boolean;
  @IsOptional() @MaxLength(50) nationality?: string;
  @IsOptional() @MaxLength(50) religion?: string;
  @IsOptional() @MaxLength(50) community?: string;
  @IsOptional() @MaxLength(50) caste?: string;
  @IsOptional() @MaxLength(50) mother_tongue?: string;
  @IsOptional() @MaxLength(10) blood_group?: string;
  @IsOptional() @IsBoolean() is_father_exserviceman?: boolean;
  @IsOptional() @MaxLength(255) exserviceman_info?: string;
  @IsOptional() @IsBoolean() is_diff_abled?: boolean;
  @IsOptional() @MaxLength(255) diff_abled_info?: string;
}
