import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  announcement_status_enum,
  target_audience_enum,
} from '../../../../../generated/prisma/client';

/** Mirrors query.md #2's proposed `announcement_category_enum` — not yet a generated Prisma enum. */
export const ANNOUNCEMENT_CATEGORY_VALUES = [
  'academic',
  'department',
  'emergency',
  'event',
  'general',
] as const;

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsEnum(target_audience_enum)
  target_audience: target_audience_enum;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids: number[];

  /** Defaults to the column's own default (published) when omitted — existing callers are unaffected. */
  @IsOptional()
  @IsEnum(announcement_status_enum)
  status?: announcement_status_enum;

  /** Not yet a real column (query.md #2) — best-effort persisted, silently dropped until that migration runs. */
  @IsOptional()
  @IsString()
  @IsIn(ANNOUNCEMENT_CATEGORY_VALUES)
  category?: string;
}
