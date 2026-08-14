import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /me/academic-clearance. Omit semester to default to the student's current semester. */
export class GetAcademicClearanceDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  semester?: number;
}
