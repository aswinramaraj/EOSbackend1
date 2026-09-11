import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendMessageDto {
  @IsInt()
  @IsPositive()
  conversationId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  /** Echoed back on message:ack so the sender can reconcile its optimistic UI row. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientGeneratedId?: string;
}
