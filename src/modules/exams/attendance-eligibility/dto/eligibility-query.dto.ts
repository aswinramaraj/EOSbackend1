import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class EligibilityQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @IsIn(['eligible', 'pending', 'detained'])
  eligibility?: 'eligible' | 'pending' | 'detained';

  @IsOptional()
  @IsString()
  search?: string;
}
