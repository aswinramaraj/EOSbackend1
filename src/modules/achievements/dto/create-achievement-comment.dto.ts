import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateAchievementCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment_text: string;
}
