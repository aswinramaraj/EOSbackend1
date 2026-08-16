import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  target_audience_enum,
  announcement_status_enum,
  announcement_category_enum,
} from '../../../../../generated/prisma/client';

export class UpdateAnnouncementDto {
  @ValidateIf((dto) => dto.title !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @ValidateIf((dto) => dto.content !== undefined)
  @IsString()
  @IsNotEmpty()
  content?: string;

  /**
   * Lets a saved draft transition to 'published' (or, less usefully, back
   * to 'draft'). Transitioning TO 'published' re-runs the same targeting
   * validation create() would require (see update() in the service) —
   * a draft can sit with no target_audience/class_ids/department_id
   * forever, but publishing it demands them just like a fresh create.
   */
  @ValidateIf((dto) => dto.status !== undefined)
  @IsEnum(announcement_status_enum)
  status?: announcement_status_enum;

  @ValidateIf((dto) => dto.target_audience !== undefined)
  @IsEnum(target_audience_enum)
  target_audience?: target_audience_enum;

  @ValidateIf((dto) => dto.class_ids !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ValidateIf((dto) => dto.department_id !== undefined)
  @IsInt()
  department_id?: number;

  @ValidateIf((dto) => dto.role_ids !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  role_ids?: number[];

  @ValidateIf((dto) => dto.file_key !== undefined)
  @IsString()
  file_key?: string;

  @ValidateIf((dto) => dto.file_name !== undefined)
  @IsString()
  @MaxLength(255)
  file_name?: string;

  @ValidateIf((dto) => dto.priority !== undefined)
  @IsString()
  @MaxLength(20)
  priority?: string;

  @ValidateIf((dto) => dto.category !== undefined)
  @IsEnum(announcement_category_enum)
  category?: announcement_category_enum;
}
