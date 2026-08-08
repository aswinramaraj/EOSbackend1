import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * One student's status within a POST /me/classes/:class_id/attendance
 * batch. attendance_status_enum has three real values (present/absent/
 * on_duty) — this used to only accept the first two (a stale copy of an
 * earlier, smaller enum), which silently blocked the "on duty" option the
 * mobile marking UI's own toggle grid already offered.
 */
export class ClassAttendanceRecordItemDto {
  @IsInt()
  student_id: number;

  @IsIn(['present', 'absent', 'on_duty'])
  status: 'present' | 'absent' | 'on_duty';
}

/**
 * POST /me/classes/:class_id/attendance (Faculty only).
 *
 * Unlike the existing POST /attendance (subject_id optional there, since
 * attendance_records.subject_id is nullable), this endpoint's documented
 * contract requires subject_id — it's used to verify the caller is actually
 * mapped (faculty_subject_class_mapping) to teach that subject for this
 * class, a check the older endpoint doesn't perform.
 *
 * `academic_year` has no column on attendance_records and is never
 * persisted — same as Lesson Plans/LMS Notes, it's accepted only to scope
 * the faculty_subject_class_mapping check, which IS academic_year-specific
 * (mappings are year-scoped; a faculty's mapping for a prior year shouldn't
 * keep authorizing attendance today).
 */
export class MarkClassAttendanceDto {
  @IsInt()
  subject_id: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'academic_year must be in the format YYYY-YY, e.g. 2025-26',
  })
  academic_year?: string;

  @IsDateString({}, { message: 'attendance_date must be a valid ISO date' })
  attendance_date: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClassAttendanceRecordItemDto)
  records: ClassAttendanceRecordItemDto[];
}
