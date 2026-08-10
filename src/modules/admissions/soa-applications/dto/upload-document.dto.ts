import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** POST /soa-applications/:id/documents — multipart form, file field "file". */
export class UploadDocumentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  certificate_type_id: number;
}
