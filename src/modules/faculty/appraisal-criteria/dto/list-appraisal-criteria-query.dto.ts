import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/** GET /appraisal-criteria — filters, layered on the shared pagination convention. */
export class ListAppraisalCriteriaQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  division_id?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'academic_year must be in the format YYYY-YYYY, e.g. 2025-2026',
  })
  academic_year?: string;
}
