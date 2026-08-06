import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export enum MalpracticeSessionValue {
  FN = 'FN',
  AN = 'AN',
}

export enum MalpracticeNature {
  unauthorised_material = 'unauthorised_material',
  copying = 'copying',
  mobile_device = 'mobile_device',
  impersonation = 'impersonation',
  misbehaviour_with_invigilator = 'misbehaviour_with_invigilator',
  answer_script_tampering = 'answer_script_tampering',
}

export enum MalpracticeAction {
  reported_to_coe = 'reported_to_coe',
  warning_issued = 'warning_issued',
  paper_cancelled = 'paper_cancelled',
  semester_cancelled = 'semester_cancelled',
  debarred_one_year = 'debarred_one_year',
  case_under_enquiry = 'case_under_enquiry',
}

export class CreateMalpracticeIncidentDto {
  @Type(() => Number)
  @IsInt({ message: 'student_id must be an integer' })
  @IsPositive({ message: 'student_id must be a positive integer' })
  student_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'exam_subject_mapping_id must be an integer' })
  @IsPositive({ message: 'exam_subject_mapping_id must be a positive integer' })
  exam_subject_mapping_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'venue_id must be an integer' })
  @IsPositive({ message: 'venue_id must be a positive integer' })
  venue_id?: number;

  @IsDateString(
    {},
    { message: 'incident_date must be a valid date (YYYY-MM-DD)' },
  )
  incident_date!: string;

  @IsEnum(MalpracticeSessionValue, { message: 'session must be FN or AN' })
  session!: MalpracticeSessionValue;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  seat_number?: string;

  @IsEnum(MalpracticeNature, { message: 'Invalid nature value' })
  nature!: MalpracticeNature;

  @IsEnum(MalpracticeAction, { message: 'Invalid action_taken value' })
  action_taken!: MalpracticeAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  invigilator_remarks?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'reported_by_faculty_id must be an integer' })
  @IsPositive({ message: 'reported_by_faculty_id must be a positive integer' })
  reported_by_faculty_id?: number;
}
