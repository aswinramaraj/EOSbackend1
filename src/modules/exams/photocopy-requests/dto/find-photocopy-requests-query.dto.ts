import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { photocopy_status_enum } from 'generated/prisma/client';

export class FindPhotocopyRequestsQueryDto extends PaginationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  student_id?: number;

  @IsOptional()
  @IsEnum(photocopy_status_enum, {
    message: `status must be one of: ${Object.values(photocopy_status_enum).join(', ')}`,
  })
  status?: photocopy_status_enum;
}
