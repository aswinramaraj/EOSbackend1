import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class GetAuditQueryDto {
  @Type(() => Number)
  @IsInt()
  department_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  semester!: number;

  @Type(() => Number)
  @IsInt()
  batch_id!: number;
}
