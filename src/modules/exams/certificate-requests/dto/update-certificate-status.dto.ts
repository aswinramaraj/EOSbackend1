import { IsIn } from 'class-validator';

export class UpdateCertificateStatusDto {
  @IsIn(['pending', 'ready_to_print', 'printed', 'issued'])
  status: 'pending' | 'ready_to_print' | 'printed' | 'issued';
}
