import { Matches } from 'class-validator';

/**
 * POST /me/wallet/pin — first-time PIN setup only (fails if one is already
 * set; use PATCH /me/wallet/pin to change an existing PIN). Exactly 4
 * digits, matching the "unique pin ... set by user in first time login"
 * requirement — no letters/symbols, this is a transfer-authorization PIN,
 * not a password.
 */
export class SetPinDto {
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin: string;
}
