import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSeatingArrangementDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  hall_plan_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  seat_number?: string;
}
