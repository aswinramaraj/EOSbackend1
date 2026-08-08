import { Type } from 'class-transformer';
import { IsNumber, IsUUID, Matches, Min } from 'class-validator';

/**
 * POST /me/wallet/transfer — the GPay-style "scan receiver's QR, enter
 * amount, enter PIN" flow. qr_token is the receiver wallet's public
 * identifier (see WalletService.resolveByQrToken - the sender's app
 * resolves+displays the receiver's name before ever calling this, but the
 * server re-resolves it here too rather than trusting the client's cached copy).
 */
export class TransferFundsDto {
  @IsUUID()
  qr_token: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin: string;
}
