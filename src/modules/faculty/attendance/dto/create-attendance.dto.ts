import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';

/**
 * One student's status within a POST /attendance batch.
 * `status` is validated against the actual attendance_status_enum values:
 * present, absent, on_duty.
 */
export class AttendanceRecordItemDto {
  @IsInt()
  student_id: number;

  @IsIn(['present', 'absent', 'on_duty'])
  status: 'present' | 'absent' | 'on_duty';
}

/**
 * POST /attendance (Faculty / Secretary).
 * Marks attendance for one or more students in a single class session.
 *
 * `subject_id` is optional because attendance_records.subject_id is nullable
 * in the schema. There is no `session` field anywhere in attendance_records —
 * schema is the source of truth, so it is intentionally absent here.
 * `marked_by_faculty_id`/`marked_by_user_id` are never client-supplied — the
 * service derives them from the authenticated caller (@CurrentUser()).
 */
export class CreateAttendanceDto {
  @IsInt()
  class_id: number;

  @IsOptional()
  @IsInt()
  subject_id?: number;

  @IsDateString({}, { message: 'date must be a valid ISO date' })
  date: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordItemDto)
  records: AttendanceRecordItemDto[];
}
