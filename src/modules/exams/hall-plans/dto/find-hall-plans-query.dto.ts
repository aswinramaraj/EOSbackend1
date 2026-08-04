import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class FindHallPlansQueryDto extends PaginationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id?: number;

  @IsOptional()
  @IsDateString()
  exam_date?: string;
}
