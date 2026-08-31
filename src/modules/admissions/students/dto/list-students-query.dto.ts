import { Transform, Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/** GET /students — query filters, layered on the project's shared pagination convention. */
export class ListStudentsQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  q?: string; // searches student_id_no, roll_no, register_no, admission_no, email, name

  /** GET /students?ids=1,2,3 — restricts to exactly these student ids, e.g. the Admin console's Fee Defaulters view (ids sourced from /finance-overview's topOutstandingStudents). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => !Number.isNaN(n));
  })
  @IsInt({ each: true })
  ids?: number[];

  /** GET /students?final_year=true — classes.current_semester >= 7 (final two semesters of a standard 4-year/8-semester programme). */
  @IsOptional()
  @IsBooleanString()
  final_year?: string;

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
