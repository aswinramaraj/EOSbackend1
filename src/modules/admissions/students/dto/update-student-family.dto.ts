import { IsEmail, IsNumber, IsOptional, MaxLength, Min } from 'class-validator';

/**
 * PATCH /students/:id/family (Admin only) — student_family_details has no
 * write path at all today (ParentsSection on the profile page renders it
 * read-only). Upserts by student_id — a student with no row yet gets one
 * created on first save, same pattern as student_contacts/addresses.
 *
 * guardian_name/guardian_relationship/guardian_phone/guardian_email also
 * exist on this table but aren't wired anywhere on the profile page (no
 * read side either) — out of scope here; add them together if that ever
 * needs to actually be shown.
 */
export class UpdateStudentFamilyDto {
  @IsOptional() @MaxLength(150) father_name?: string;
  @IsOptional() @MaxLength(150) father_qualification?: string;
  @IsOptional() @MaxLength(150) father_occupation?: string;
  @IsOptional() @IsNumber() @Min(0) father_annual_income?: number;
  @IsOptional() @IsEmail() @MaxLength(255) father_email?: string;
  @IsOptional() @MaxLength(20) father_mobile?: string;

  @IsOptional() @MaxLength(150) mother_name?: string;
  @IsOptional() @MaxLength(150) mother_qualification?: string;
  @IsOptional() @MaxLength(150) mother_occupation?: string;
  @IsOptional() @IsNumber() @Min(0) mother_annual_income?: number;
  @IsOptional() @IsEmail() @MaxLength(255) mother_email?: string;
  @IsOptional() @MaxLength(20) mother_mobile?: string;
}
