import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  student_type_enum,
  dayscholar_mode_enum,
} from 'generated/prisma/client';

const VALID_STUDENT_TYPES = Object.values(student_type_enum);
const VALID_DAYSCHOLAR_MODES = Object.values(dayscholar_mode_enum);

/**
 * One row of a bulk import — deliberately just the fields
 * CreatePerfectEntryDto marks as unconditionally required, plus
 * course/quota/batch as human-readable identifiers (real counselling-
 * authority data has course codes and quota/batch names, never this app's
 * internal auto-increment ids) resolved server-side, and first_name (the
 * one CreateSoaApplicationDto field that's actually required). Everything
 * else a full single-admission perfect-entry supports (addresses, identity
 * marks, certificates, family details) is deliberately out of scope here —
 * those stay editable afterwards via the existing Edit Profile flow, same
 * as any other student.
 */
export class BulkImportStudentRowDto {
  @IsString()
  @IsNotEmpty({ message: 'first_name is required' })
  @MaxLength(100)
  first_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @IsEmail({}, { message: 'email must be a valid email' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'student_id_no is required' })
  @MaxLength(30)
  student_id_no: string;

  @IsOptional() @IsString() @MaxLength(20) roll_no?: string;
  @IsOptional() @IsString() @MaxLength(30) register_no?: string;

  @IsString()
  @IsNotEmpty({ message: 'course_code is required' })
  course_code: string;

  @IsString()
  @IsNotEmpty({ message: 'quota_name is required' })
  quota_name: string;

  @IsString()
  @IsNotEmpty({ message: 'batch_name is required' })
  batch_name: string;

  @IsIn(VALID_STUDENT_TYPES, {
    message: `student_type must be one of: ${VALID_STUDENT_TYPES.join(', ')}`,
  })
  student_type: student_type_enum;

  @IsOptional()
  @IsIn(VALID_DAYSCHOLAR_MODES, {
    message: `dayscholar_mode must be one of: ${VALID_DAYSCHOLAR_MODES.join(', ')}`,
  })
  dayscholar_mode?: dayscholar_mode_enum;

  @IsOptional() @IsString() @MaxLength(30) vehicle_number?: string;

  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsDateString() date_of_birth?: string;
}

export class BulkImportStudentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkImportStudentRowDto)
  rows: BulkImportStudentRowDto[];
}
