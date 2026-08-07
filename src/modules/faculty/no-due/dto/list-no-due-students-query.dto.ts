import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /me/no-due/students?batch_id=&status=&search=&page=&limit=
 * `status` defaults to 'cleared' in the service (matches the screen's own
 * default tab). `search` matches against student_id_no/register_no/roll_no.
 */
export class ListNoDueStudentsQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batch_id?: number;

  @IsOptional()
  @IsIn(['cleared', 'pending'])
  status?: 'cleared' | 'pending';

  @IsOptional()
  @IsString()
  search?: string;
}
