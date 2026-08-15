import { IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /me/lms/folders/:id/resources/file (Faculty/HoD only, own folder) — multipart, title/description as form fields alongside the file. */
export class CreateFileResourceDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
