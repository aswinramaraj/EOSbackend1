import { IsIn } from 'class-validator';

export class UpdateFeeStatusDto {
  @IsIn(['paid', 'unpaid', 'partial'])
  fee_status: 'paid' | 'unpaid' | 'partial';
}
