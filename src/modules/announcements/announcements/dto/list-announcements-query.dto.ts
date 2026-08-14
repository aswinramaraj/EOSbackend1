import { IsEnum, IsOptional } from 'class-validator';
import { announcement_status_enum } from '../../../../../generated/prisma/client';

/** GET /announcements?status= — optional filter, e.g. status=draft for the "Drafts" tab. */
export class ListAnnouncementsQueryDto {
  @IsOptional()
  @IsEnum(announcement_status_enum)
  status?: announcement_status_enum;
}
