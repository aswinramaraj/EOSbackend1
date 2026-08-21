import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /me/hr-queries (Faculty only) — multipart; `file` is an optional
 * attachment alongside these fields. category is free text (matches
 * whatever the HR department actually tracks — e.g. "PF / ESI query",
 * "Increment / arrears", "Bank account change" — not a fixed backend enum,
 * since hr_queries is a new table with no pre-existing category taxonomy).
 */
export class CreateHrQueryDto {
  @IsString()
  @MaxLength(100)
  category: string;

  @IsString()
  @MaxLength(200)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
