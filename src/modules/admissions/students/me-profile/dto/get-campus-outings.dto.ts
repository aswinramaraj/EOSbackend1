import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { student_leave_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(student_leave_status_enum);

export class GetCampusOutingsDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid outing status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: student_leave_status_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
