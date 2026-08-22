import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** Same shared shape/convention as src/common/dto/fuzzy-search.dto.ts. */
export class SearchStudentsQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Search query is required.' })
  @MinLength(2, { message: 'Search query must be at least 2 characters long.' })
  q!: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 20;
}
