import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class MarksRosterQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_subject_mapping_id!: number;
}
