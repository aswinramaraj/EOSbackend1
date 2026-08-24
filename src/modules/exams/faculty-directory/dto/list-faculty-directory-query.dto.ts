import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * GET /exam-faculty-directory — read-only faculty lookup for the COE module
 * (invigilator assignment, malpractice reporting-faculty picker). Reuses the
 * existing `faculty` table; no write access and no other module's routes
 * are touched.
 */
export class ListFacultyDirectoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  department_id?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
