import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExamFeeTransactionDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsIn([
    'exam_fee',
    'arrear_fee',
    'revaluation_fee',
    'certificate_fee',
    'late_fee',
  ])
  fee_head:
    | 'exam_fee'
    | 'arrear_fee'
    | 'revaluation_fee'
    | 'certificate_fee'
    | 'late_fee';

  @Type(() => Number)
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsIn(['online', 'challan', 'counter'])
  mode?: 'online' | 'challan' | 'counter';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference_no?: string;
}
