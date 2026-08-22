import { IsEmail, IsOptional, MaxLength } from 'class-validator';

/**
 * PATCH /students/:id/contacts (Admin only) — student_contacts has no write
 * path at all today (ContactSection on the profile page renders it read-only)
 * even though it's shown right next to fields the main edit form can already
 * change. Upserts by student_id, same one-row-per-student shape as
 * student_family_details below.
 */
export class UpdateStudentContactsDto {
  @IsOptional() @IsEmail() @MaxLength(255) student_email1?: string;
  @IsOptional() @IsEmail() @MaxLength(255) student_email2?: string;
  @IsOptional() @MaxLength(20) student_mobile?: string;
}
