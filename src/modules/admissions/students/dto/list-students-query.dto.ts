import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/** GET /students — query filters, layered on the project's shared pagination convention. */
export class ListStudentsQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  q?: string; // searches student_id_no, roll_no, register_no, admission_no, email, name

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batch_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  course_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quota_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number; // filters via students.courses.department_id

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(['hosteller', 'dayscholar'])
  student_type?: 'hosteller' | 'dayscholar';
}
