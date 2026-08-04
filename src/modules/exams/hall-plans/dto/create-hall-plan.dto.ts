import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateHallPlanDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id!: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  venue_id!: number;

  @IsDateString()
  exam_date!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  capacity?: number;
}
