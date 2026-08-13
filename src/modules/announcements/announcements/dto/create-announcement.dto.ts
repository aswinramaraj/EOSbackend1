import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  announcement_category_enum,
  announcement_status_enum,
  target_audience_enum,
} from '../../../../../generated/prisma/client';

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

  /** Optional — omit for the existing default behavior (published immediately). Lets a caller explicitly save as a draft using the announcement_status_enum's existing 'draft' value, which no code previously set. */
  @IsOptional()
  @IsEnum(announcement_status_enum)
  status?: announcement_status_enum;

  @IsOptional()
  @IsEnum(announcement_category_enum)
  category?: announcement_category_enum;

  /** Optional future publish time. Purely informational for now — no scheduled job flips status at this time yet, so a scheduled announcement is created as 'draft' and must still be published manually when the time comes. */
  @IsOptional()
  @IsDateString()
  scheduled_at?: string;
}
