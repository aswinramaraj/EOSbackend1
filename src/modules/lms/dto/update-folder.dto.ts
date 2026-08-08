import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH /me/lms/folders/:id (Faculty/HoD only, own folder). */
export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  class_ids?: number[];
}
