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
   * mapping — is_published itself no longer lives on exam_timetable, it
   * moved to exam_subject_mapping (per-subject), and the row's own
   * exam_timetable_versions.status (draft/published) supersedes what this
   * flag used to mean at the slot level. version_id (which exam_timetable
   * rows still key off internally) isn't part of this DTO at all — the
   * service resolves/creates the exam's one implicit version itself via
   * getOrCreateDefaultVersion(), since this module has no version-
   * management API of its own for a client to select one from.
   */
  @IsOptional()
  @IsBoolean({ message: 'is_published must be a boolean' })
  is_published?: boolean;
}
