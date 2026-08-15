import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  ValidateNested,
} from 'class-validator';

/**
 * One student's mark within a PUT /sports-admin/sessions/:id/attendance
 * batch. attendance_status_enum has three values (present/absent/on_duty) —
 * same shape as ClassAttendanceRecordItemDto in faculty/attendance.
 */
export class MarkAttendanceEntryDto {
  @IsInt()
  student_id: number;

  @IsIn(['present', 'absent', 'on_duty'])
  status: 'present' | 'absent' | 'on_duty';
}

export class MarkAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarkAttendanceEntryDto)
  marks: MarkAttendanceEntryDto[];
}
