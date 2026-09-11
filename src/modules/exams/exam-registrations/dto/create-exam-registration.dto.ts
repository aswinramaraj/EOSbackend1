import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateExamRegistrationDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsOptional()
  @IsIn(['paid', 'unpaid', 'partial'])
  fee_status?: 'paid' | 'unpaid' | 'partial';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
