import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /students/:id/reset-password — password is optional: provide one to
 * set it exactly, or omit it to have the server generate a random one. The
 * plaintext is returned in the response either way (this is the ONLY point
 * it ever exists outside the admin's own head — password_hash is one-way).
 *
 * `adminPassword` is a step-up confirmation: the calling admin's own login
 * password, required so an unattended/logged-in admin session can't be used
 * to silently grab a student's new credentials. Checked against the admin's
 * own users.password_hash before anything else runs.
 */
export class ResetStudentPasswordDto {
  @IsString({ message: 'Re-enter your password to confirm this action' })
  @MinLength(1, { message: 'Re-enter your password to confirm this action' })
  adminPassword: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'password must be at least 6 characters' })
  @MaxLength(72)
  password?: string;
}
