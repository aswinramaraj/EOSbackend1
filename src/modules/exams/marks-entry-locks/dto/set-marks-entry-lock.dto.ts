import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsPositive } from 'class-validator';

export class SetMarksEntryLockDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id!: number;

  @IsBoolean()
  is_locked!: boolean;
}
