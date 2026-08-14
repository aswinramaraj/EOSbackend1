import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { sports_announcement_cat_enum } from 'generated/prisma/client';

const VALID_CATEGORIES = Object.values(sports_announcement_cat_enum);

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsIn(VALID_CATEGORIES, {
    message: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
  })
  category?: sports_announcement_cat_enum;
}
