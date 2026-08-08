import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** POST /me/lms/folders/:id/resources/link (Faculty/HoD only, own folder). */
export class CreateLinkResourceDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsUrl({ require_protocol: true }, { message: 'link_url must be a valid URL including http(s)://' })
  @MaxLength(500)
  link_url: string;
}
