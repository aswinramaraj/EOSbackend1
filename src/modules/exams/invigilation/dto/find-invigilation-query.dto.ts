import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class FindInvigilationQueryDto extends PaginationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  hall_plan_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  faculty_id?: number;

  @IsOptional()
  @IsDateString()
  duty_date?: string;
}
