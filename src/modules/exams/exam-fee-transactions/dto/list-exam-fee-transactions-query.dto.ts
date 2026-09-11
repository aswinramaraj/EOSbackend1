import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListExamFeeTransactionsQueryDto {
  @IsOptional()
  @IsIn([
    'exam_fee',
    'arrear_fee',
    'revaluation_fee',
    'certificate_fee',
    'late_fee',
  ])
  fee_head?:
    | 'exam_fee'
    | 'arrear_fee'
    | 'revaluation_fee'
    | 'certificate_fee'
    | 'late_fee';

  @IsOptional()
  @IsIn(['online', 'challan', 'counter'])
  mode?: 'online' | 'challan' | 'counter';

  @IsOptional()
  @IsIn(['paid', 'pending', 'unpaid', 'refunded'])
  status?: 'paid' | 'pending' | 'unpaid' | 'refunded';

  @IsOptional()
  @IsString()
  search?: string;
}
