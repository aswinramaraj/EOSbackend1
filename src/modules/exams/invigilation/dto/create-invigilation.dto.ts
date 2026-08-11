import { IsDateString, IsIn, IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

// exam_session_enum (schema.prisma) — FN (forenoon) / AN (afternoon).
const EXAM_SESSIONS = ['FN', 'AN'] as const;

export class CreateInvigilationDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id!: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  hall_plan_id!: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  faculty_id!: number;

  @IsDateString()
  duty_date!: string;

  @IsIn(EXAM_SESSIONS, { message: 'session must be FN or AN' })
  session!: 'FN' | 'AN';
}
