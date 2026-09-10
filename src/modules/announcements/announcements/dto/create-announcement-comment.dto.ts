import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAnnouncementCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment_text: string;

  /** Replying to another comment on the same post — one level of nesting only. */
  @IsOptional()
  @IsInt()
  parent_comment_id?: number;
}
