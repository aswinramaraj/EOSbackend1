import { IsIn, IsOptional, IsString } from 'class-validator';

export class MarkAttendanceDto {
  @IsIn(['present', 'absent'])
  status!: 'present' | 'absent';

  /** YYYY-MM-DD, defaults to today server-side when omitted. */
  @IsOptional()
  @IsString()
  date?: string;
}
