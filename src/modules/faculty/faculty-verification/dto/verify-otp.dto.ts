import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * POST /me/faculty-verification/check (Admin only).
 * Asks Twilio Verify whether `code` matches the most recent verification
 * sent to `phone`. A wrong code is a normal 200 response with
 * `valid: false` (Twilio's own semantics), not an error.
 */
export class VerifyOtpDto {
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: 'code is required' })
  code: string;
}
