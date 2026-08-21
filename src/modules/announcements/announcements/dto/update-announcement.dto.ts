import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
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
import { SOCIAL_POST_FORMATS } from './create-announcement.dto';

export class UpdateAnnouncementDto {
  @ValidateIf((dto: UpdateAnnouncementDto) => dto.title !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.content !== undefined)
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
  @ValidateIf((dto: UpdateAnnouncementDto) => dto.status !== undefined)
  @IsEnum(announcement_status_enum)
  status?: announcement_status_enum;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.target_audience !== undefined)
  @IsEnum(target_audience_enum)
  target_audience?: target_audience_enum;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.class_ids !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.department_id !== undefined)
  @IsInt()
  department_id?: number;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.role_ids !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  role_ids?: number[];

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.category !== undefined)
  @IsEnum(announcement_category_enum)
  category?: announcement_category_enum;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.file_key !== undefined)
  @IsString()
  file_key?: string;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.file_name !== undefined)
  @IsString()
  @MaxLength(255)
  file_name?: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsIn(SOCIAL_POST_FORMATS)
  format?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  link_url?: string;

  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_comments?: boolean;

  @ValidateIf((dto: UpdateAnnouncementDto) => dto.priority !== undefined)
  @IsString()
  @MaxLength(20)
  priority?: string;
}
