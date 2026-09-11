import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** POST /announcements/:id/comments */
export class CreateAnnouncementCommentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'A comment cannot be empty' })
  @MaxLength(2000)
  comment_text: string;

  /** Set to reply to an existing comment on the same announcement. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_comment_id?: number;
}
