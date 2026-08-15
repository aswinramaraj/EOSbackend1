import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

/** GET /sports-admin/sessions/attendance-summary?discipline_id= — optional filter. */
export class AttendanceSummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  discipline_id?: number;
}
