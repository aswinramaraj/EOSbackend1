import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListDocumentsQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsIn(['pending', 'verified', 'missing'])
  status?: 'pending' | 'verified' | 'missing';

  @IsOptional()
  category?: string;
}
