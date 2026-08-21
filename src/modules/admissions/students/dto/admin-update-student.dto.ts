import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';

/**
 * Scoped to the `students` table's own columns, plus first_name/last_name
 * — those two aren't students columns at all (see StudentsService.update's
 * own comment: the name lives on the linked soa_applications row), but
 * they're the one thing every other field here has no meaning without, and
 * splitting name-editing into its own endpoint just to keep this DTO
 * table-pure would make "rename a student" a second, confusing save action
 * for no real benefit. Updating student_contacts/student_family_details/
 * student_identity_marks is still a separate concern — see PATCH
 * /students/:id/contacts, /family, /identity-marks. student_addresses is
 * the other exception: see PATCH /students/:id/addresses
 * (StudentsService.updateAddresses) for editing those after admission.
 */
export class AdminUpdateStudentDto {
  // soa_applications.first_name is NOT NULL — @IsNotEmpty (not just
  // @IsOptional) so a blank string can't silently null out a required
  // column; last_name is nullable there, so it stays plain @IsOptional.
  @IsOptional() @IsNotEmpty() @MaxLength(100) first_name?: string;
  @IsOptional() @MaxLength(100) last_name?: string;
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
