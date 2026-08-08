import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

/**
 * POST /me/od-requests/:id/attachments — multipart/form-data. Text fields
 * alongside the "photo"/"certificate" files (@UploadedFiles), same split as
 * AppraisalController.addAttachments' division_id text field next to files.
 */
export class UploadOdAttachmentDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
