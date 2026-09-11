import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsPositive } from 'class-validator';
import { exam_session_enum } from 'generated/prisma/client';

export class OverviewQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;

  @IsDateString()
  exam_date!: string;

  @IsIn(Object.values(exam_session_enum))
  session!: (typeof exam_session_enum)[keyof typeof exam_session_enum];
}
