import { IsIn } from 'class-validator';

export class UpdateExamFeeStatusDto {
  @IsIn(['paid', 'pending', 'unpaid', 'refunded'])
  status: 'paid' | 'pending' | 'unpaid' | 'refunded';
}
