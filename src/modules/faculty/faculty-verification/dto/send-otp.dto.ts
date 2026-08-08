import { IsIn, IsString, Matches } from 'class-validator';

/**
 * POST /me/faculty-verification/send (Admin only).
 * Kicks off a Twilio Verify verification for a 10-digit Indian mobile
 * number over SMS or WhatsApp. No OTP is generated or stored here — Twilio
 * owns the code, its expiry, and its attempt count entirely.
 */
export class SendOtpDto {
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone: string;

  @IsIn(['sms', 'whatsapp'])
  channel: 'sms' | 'whatsapp';
}
