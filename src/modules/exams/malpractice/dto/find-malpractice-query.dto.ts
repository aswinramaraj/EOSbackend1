import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class FindMalpracticeQueryDto extends PaginationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  student_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  venue_id?: number;

  @IsOptional()
  @IsDateString()
  incident_date?: string;
}
