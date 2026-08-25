import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { timetable_version_status_enum } from 'generated/prisma/client';

export class ListVersionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id?: number;

  @IsOptional()
  @IsIn(Object.values(timetable_version_status_enum))
  status?: (typeof timetable_version_status_enum)[keyof typeof timetable_version_status_enum];
}
