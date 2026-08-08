import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsInt } from 'class-validator';

/** GET /faculty/id-card/status?faculty_ids=1,2,3 — comma-separated ids, for the bulk-issue preview. */
export class ListIdCardStatusQueryDto {
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => !Number.isNaN(n));
  })
  @ArrayNotEmpty({ message: 'faculty_ids must include at least one id' })
  @IsInt({ each: true })
  faculty_ids: number[];
}
