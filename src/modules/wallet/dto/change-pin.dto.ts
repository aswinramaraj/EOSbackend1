import { Matches } from 'class-validator';

/** PATCH /me/wallet/pin — change an already-set PIN; requires the current one. */
export class ChangePinDto {
  @Matches(/^\d{4}$/, { message: 'current_pin must be exactly 4 digits' })
  current_pin: string;

  @Matches(/^\d{4}$/, { message: 'new_pin must be exactly 4 digits' })
  new_pin: string;
}
