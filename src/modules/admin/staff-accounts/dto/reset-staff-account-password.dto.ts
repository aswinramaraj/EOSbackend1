import { IsString, MinLength } from 'class-validator';

/**
 * POST /staff-accounts/:id/reset-password
 * `adminPassword` is the same step-up confirmation ResetStudentPasswordDto
 * uses: the calling admin's own current password, checked against their own
 * users.password_hash before this runs — required because this action
 * overwrites an existing login's credential (unlike account creation, which
 * doesn't touch anyone else's existing access).
 */
export class ResetStaffAccountPasswordDto {
  @IsString({ message: 'Re-enter your password to confirm this action' })
  @MinLength(1, { message: 'Re-enter your password to confirm this action' })
  adminPassword: string;
}
