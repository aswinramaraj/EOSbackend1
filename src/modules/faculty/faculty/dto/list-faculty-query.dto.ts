import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/** GET /faculty — query filters, layered on the project's shared pagination convention. */
export class ListFacultyQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  /** Matches against first/last name and login email — case-insensitive substring. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['probation', 'confirmed', 'on_leave', 'resigned', 'retired'])
  employment_status?: string;
}
