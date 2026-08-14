import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/** POST /me/profile/social-links — user-authored, free-form title + link. */
export class CreateSocialLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @IsUrl(
    { require_protocol: true },
    { message: 'url must be a valid URL including http(s)://' },
  )
  @MaxLength(500)
  url: string;
}
