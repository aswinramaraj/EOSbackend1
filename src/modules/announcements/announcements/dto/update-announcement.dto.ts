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
  ValidateIf,
} from 'class-validator';
import { target_audience_enum } from '../../../../../generated/prisma/client';
import { ANNOUNCEMENT_CATEGORY_VALUES } from './create-announcement.dto';

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

  @ValidateIf((dto) => dto.target_audience !== undefined)
  @IsEnum(target_audience_enum)
  target_audience?: target_audience_enum;

  @ValidateIf((dto) => dto.class_ids !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  /** Not yet a real column (query.md #2) — best-effort persisted, silently dropped until that migration runs. */
  @IsOptional()
  @IsString()
  @IsIn(ANNOUNCEMENT_CATEGORY_VALUES)
  category?: string;
}
