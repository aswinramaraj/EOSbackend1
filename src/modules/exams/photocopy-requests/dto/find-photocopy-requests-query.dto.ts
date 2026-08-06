import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export enum PhotocopyStatusValue {
  requested = 'requested',
  scanned = 'scanned',
  issued = 'issued',
  rejected = 'rejected',
}

export class FindPhotocopyRequestsQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_marks_id?: number;

  @IsOptional()
  @IsEnum(PhotocopyStatusValue, { message: 'Invalid status value' })
  status?: PhotocopyStatusValue;
}
