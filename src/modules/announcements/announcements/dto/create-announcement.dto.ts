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
   * Required for every target_audience except 'teachers', 'roles', and the
   * EDC-specific audiences ('edc_founders'/'edc_inside_college'/
   * 'edc_all_entrepreneurs') - those three are plain broadcast labels with
   * no class/department/role targeting mechanism behind them (no "founders"
   * recipient list exists in the schema yet), same category of exception
   * as 'teachers'/'roles'. Never required for a draft.
   */
  @ValidateIf(
    (dto: CreateAnnouncementDto) =>
      dto.status !== 'draft' &&
      dto.target_audience !== 'teachers' &&
      dto.target_audience !== 'roles' &&
      dto.target_audience !== 'edc_founders' &&
      dto.target_audience !== 'edc_inside_college' &&
      dto.target_audience !== 'edc_all_entrepreneurs',
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

  /** From POST /announcements/attachments' response — never uploaded here. */
  @IsOptional()
  @IsString()
  file_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;

  /**
   * Real column (`announcements.priority`), added specifically for the EDC
   * module's High/Medium/Normal tags — free text, not an enum, since no
   * fixed severity scale exists anywhere else in the schema to reuse.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  priority?: string;

  /**
   * Real column (`announcements.category`) — was a schema column with no
   * DTO field and never written by the service until now (the Secretary
   * module's composer needs it for its Category selector: ACADEMIC/
   * DEPARTMENT/EVENT/EMERGENCY/GENERAL). No migration needed, the column
   * already existed.
   */
  @IsOptional()
  @IsEnum(announcement_category_enum)
  category?: announcement_category_enum;
}
