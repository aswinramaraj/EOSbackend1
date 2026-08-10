import { IsEnum, IsOptional, Matches } from 'class-validator';

export enum FacultyAttendanceStatusInput {
  full_day = 'full_day',
  half_day = 'half_day',
  absent = 'absent',
  on_duty = 'on_duty',
  on_leave = 'on_leave',
  weekly_off = 'weekly_off',
  holiday = 'holiday',
}

/**
 * PUT /me/faculty/:id/attendance/:date (Admin/HR Payroll only).
 *
 * There is no biometric/punch import wired up yet, so this is the only way
 * faculty_daily_attendance gets populated for a given day. Upserts on the
 * table's [faculty_id, attendance_date] unique key.
 */
export class MarkFacultyAttendanceDto {
  @IsEnum(FacultyAttendanceStatusInput)
  status: FacultyAttendanceStatusInput;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'punch_in must be in HH:mm 24-hour format',
  })
  punch_in?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'punch_out must be in HH:mm 24-hour format',
  })
  punch_out?: string;
}
