import { IsInt, IsPositive } from 'class-validator';

export class SendChatRequestDto {
  @IsInt()
  @IsPositive()
  receiverUserId: number;
}
