import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class GetMappingQueryDto {
  @Type(() => Number)
  @IsInt()
  department_id!: number;
}
