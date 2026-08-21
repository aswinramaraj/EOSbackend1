import { IsDateString, IsEnum, IsOptional } from 'class-validator';

/** Matches the real faculty_attendance_status_enum exactly — no "on_vacation" value exists there. */
export enum StaffAttendanceStatus {
  FULL_DAY = 'full_day',
  HALF_DAY = 'half_day',
  ABSENT = 'absent',
  ON_DUTY = 'on_duty',
  ON_LEAVE = 'on_leave',
}

export class MarkAttendanceDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsEnum(StaffAttendanceStatus)
  status: StaffAttendanceStatus;
}
