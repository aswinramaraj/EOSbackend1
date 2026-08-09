import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /me/lms/folders (Faculty/HoD only).
 * class_ids lets one folder be shared to every class the caller teaches
 * this subject to at once (Google Classroom-style) - see
 * lms_folder_classes. faculty_id is never client-supplied.
 */
export class CreateFolderDto {
  @IsInt()
  subject_id: number;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  class_ids: number[];
}
