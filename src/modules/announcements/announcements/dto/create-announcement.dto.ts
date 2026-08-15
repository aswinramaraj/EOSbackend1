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

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  /**
   * Defaults to 'published' in the service when omitted. A 'draft' skips
   * every targeting requirement below entirely — it's a private scratchpad
   * only the author can see (see buildVisibilityQuery), not yet addressed
   * to anyone.
   */
  @IsOptional()
  @IsEnum(announcement_status_enum)
  status?: announcement_status_enum;

  /**
   * Required once status is 'published' (or omitted, defaulting to
   * 'published') — never required for a draft.
   */
  @ValidateIf((dto: CreateAnnouncementDto) => dto.status !== 'draft')
  @IsEnum(target_audience_enum)
  target_audience?: target_audience_enum;

  /**
   * Required for every target_audience except 'teachers' and 'roles' -
   * that's the class-targeted flow, persisted via announcement_class_mapping.
   * Never required for a draft.
   */
  @ValidateIf(
    (dto: CreateAnnouncementDto) =>
      dto.status !== 'draft' &&
      dto.target_audience !== 'teachers' &&
      dto.target_audience !== 'roles',
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  /**
   * Only meaningful when target_audience === 'teachers' - broadcasts to
   * every faculty account in this department via the (previously dead)
   * announcements.department_id column. HOD callers may only target their
   * own department (enforced in the service, see resolveTeacherTargetDepartment);
   * Admin may target any department, or omit it for an all-faculty broadcast.
   */
  @ValidateIf(
    (dto: CreateAnnouncementDto) =>
      dto.status !== 'draft' && dto.target_audience === 'teachers',
  )
  @IsOptional()
  @IsInt()
  department_id?: number;

  /**
   * Required when target_audience === 'roles' - a Principal/Admin-only
   * capability that targets specific backend roles directly (e.g. HOD,
   * Placement, Library), persisted via announcement_role_mapping. A
   * "broadcast to everyone" is just every role id from GET
   * /announcements/lookup/roles, not a distinct value.
   */
  @ValidateIf(
    (dto: CreateAnnouncementDto) =>
      dto.status !== 'draft' && dto.target_audience === 'roles',
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  role_ids?: number[];

  /** Purely a display tag on the list (emergency/department/academic/event/general) — orthogonal to target_audience, which controls actual visibility. */
  @IsOptional()
  @IsEnum(announcement_category_enum)
  category?: announcement_category_enum;

  /** From POST /announcements/attachments' response — never uploaded here. */
  @IsOptional()
  @IsString()
  file_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;
}
