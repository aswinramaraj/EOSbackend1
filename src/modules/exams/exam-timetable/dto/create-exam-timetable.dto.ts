// dto/create-exam-timetable.dto.ts
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

// exam_session_enum (schema.prisma) — FN (forenoon) / AN (afternoon). Only
// two real values, so a plain @IsIn is enough without pulling in the
// generated enum type for one check.
const EXAM_SESSIONS = ['FN', 'AN'] as const;

export class CreateExamTimetableDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_subject_mapping_id must be an integer' })
  @IsPositive({ message: 'exam_subject_mapping_id must be a positive integer' })
  exam_subject_mapping_id!: number;

  /**
   * exam_timetable.version_id (required, no default) — every slot now
   * belongs to a specific exam_timetable_versions row (draft/published
   * versioning); there is no longer a version-less slot. is_published, the
   * old boolean this DTO carried, no longer exists on this table at all —
   * it moved to exam_subject_mapping (per-subject) and the version's own
   * `status` (draft/published) supersedes what this flag used to mean.
   */
  @Type(() => Number)
  @IsInt({ message: 'version_id must be an integer' })
  @IsPositive({ message: 'version_id must be a positive integer' })
  version_id!: number;

  @IsIn(EXAM_SESSIONS, { message: 'session must be FN or AN' })
  session!: 'FN' | 'AN';

  @IsNotEmpty({ message: 'exam_date is required' })
  @IsDateString({}, { message: 'exam_date must be a valid date (YYYY-MM-DD)' })
  exam_date!: string;

  @IsNotEmpty({ message: 'start_time is required' })
  @Matches(TIME_REGEX, {
    message: 'start_time must be in HH:mm or HH:mm:ss format',
  })
  start_time!: string;

  @IsNotEmpty({ message: 'end_time is required' })
  @Matches(TIME_REGEX, {
    message: 'end_time must be in HH:mm or HH:mm:ss format',
  })
  end_time!: string;

  /**
   * Optional passthrough: when provided, create()/update() also flip
   * exam_subject_mapping.is_published (and published_at) for this slot's
   * mapping, per the note on version_id above — is_published itself no
   * longer lives on exam_timetable.
   */
  @IsOptional()
  @IsBoolean({ message: 'is_published must be a boolean' })
  is_published?: boolean;
}
