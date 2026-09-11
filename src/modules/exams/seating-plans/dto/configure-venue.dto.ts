import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { exam_session_enum, seating_allocation_mode_enum, seating_pattern_enum } from 'generated/prisma/client';

export class ConfigureVenueDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;

  @IsDateString()
  exam_date!: string;

  @IsIn(Object.values(exam_session_enum))
  session!: (typeof exam_session_enum)[keyof typeof exam_session_enum];

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  venue_id!: number;

  @IsOptional()
  @IsIn(Object.values(seating_allocation_mode_enum))
  allocation_mode?: (typeof seating_allocation_mode_enum)[keyof typeof seating_allocation_mode_enum];

  @IsOptional()
  @IsIn(Object.values(seating_pattern_enum))
  pattern?: (typeof seating_pattern_enum)[keyof typeof seating_pattern_enum];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  department_ids?: number[];
}
