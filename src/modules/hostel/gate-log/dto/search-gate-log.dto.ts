import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { entry_type_enum } from 'generated/prisma/client';

export class SearchGateLogDto {
  /**
   * Free-text filter applied in the database across every field the warden
   * might type — name, roll number, register number, student id and room.
   * Filtering server-side matters here: the page only holds one page of rows,
   * so a client-side filter silently searched just that page and appeared
   * broken for anyone not already on screen.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  student_id?: number;

  @IsOptional()
  @IsEnum(entry_type_enum)
  entry_type?: entry_type_enum;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  hostel_id?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
