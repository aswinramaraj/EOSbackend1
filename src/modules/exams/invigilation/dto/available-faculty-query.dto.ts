import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import { exam_session_enum } from 'generated/prisma/client';

export class AvailableFacultyQueryDto {
  @IsDateString()
  date!: string;

  @IsIn(Object.values(exam_session_enum), {
    message: `session must be one of: ${Object.values(exam_session_enum).join(', ')}`,
  })
  session!: exam_session_enum;

  // Real session start/end for the selected hall (from venues-overview), when known —
  // falls back to the institution's standard FN/AN window otherwise. HH:mm.
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'start_time must be in HH:mm format' })
  start_time?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'end_time must be in HH:mm format' })
  end_time?: string;

  @IsOptional()
  search?: string;
}
