import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { announcement_category_enum } from 'generated/prisma/client';

/** POST /hostel/announcements — always published, always audience "students" (the only real fit for a hostel circular here). */
export class CreateHostelAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsEnum(announcement_category_enum)
  category?: announcement_category_enum;
}
