import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The mobile app always has a semester selected (its picker defaults to the
 * student's most recent semester), so semester is required here rather than
 * defaulting server-side to the student's current class - keeps the
 * resolution logic in one place (the client) instead of two.
 */
export class GetExamResultsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  semester: number;
}
