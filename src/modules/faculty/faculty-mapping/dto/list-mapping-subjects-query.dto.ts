import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * GET /faculty-mapping/lookup/subjects?batch_id=&search=
 * `batch_id` is required — the "Assigned Faculty" screen always has one
 * selected (defaulting to the first batch in the HoD's own department),
 * there is no "all batches" mode. `search` matches subject name,
 * case-insensitive.
 */
export class ListMappingSubjectsQueryDto {
  @Type(() => Number)
  @IsInt()
  batch_id: number;

  @IsOptional()
  @IsString()
  search?: string;
}
