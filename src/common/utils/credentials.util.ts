import crypto from 'node:crypto';

/** Characters used for generated temporary passwords — excludes visually ambiguous chars (0/O, 1/l/I). */
const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Shared by every module that provisions a login (Faculty, Staff Accounts) so password hashing isn't reimplemented per module. */
export function hashPassword(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

/** Alphanumeric temp password for staff-style accounts (Faculty, Staff Accounts). Students use their own numeric generator (SMS-friendly), kept separate deliberately. */
export function generateTemporaryPassword(): string {
  const bytes = crypto.randomBytes(10);
  let password = '';
  for (const byte of bytes) {
    password += TEMP_PASSWORD_CHARSET[byte % TEMP_PASSWORD_CHARSET.length];
  }
  return `${password}@1`;
}
