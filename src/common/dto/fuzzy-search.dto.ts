import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Shared query DTO for typo-tolerant (pg_trgm) search endpoints, e.g.
 * GET /books/search?q=... and GET /book-categories/search?q=...
 */
export class FuzzySearchDto {
  @IsString()
  @IsNotEmpty({ message: 'Search query is required.' })
  @MinLength(2, { message: 'Search query must be at least 2 characters long.' })
  q: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 20;
}
