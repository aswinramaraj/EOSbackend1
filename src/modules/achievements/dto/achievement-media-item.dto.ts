import { IsEnum, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { achievement_media_type_enum } from '../../../../generated/prisma/enums';

/** A single photo/video attached to an achievement post. */
export class AchievementMediaItemDto {
  @IsEnum(achievement_media_type_enum)
  media_type: achievement_media_type_enum;

  @IsUrl()
  @MaxLength(500)
  media_url: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  thumbnail_url?: string;
}
