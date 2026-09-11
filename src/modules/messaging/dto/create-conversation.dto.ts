import { IsInt, IsPositive } from 'class-validator';

export class CreateConversationDto {
  @IsInt()
  @IsPositive()
  otherUserId: number;
}
