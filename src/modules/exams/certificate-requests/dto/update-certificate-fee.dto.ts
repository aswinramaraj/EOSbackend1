import { IsBoolean } from 'class-validator';

export class UpdateCertificateFeeDto {
  @IsBoolean()
  fee_paid: boolean;
}
