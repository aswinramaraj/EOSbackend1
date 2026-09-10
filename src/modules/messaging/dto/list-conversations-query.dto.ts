import { IsInt, IsOptional, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListConversationsQueryDto {
  /** Cursor: return conversations with last_message_at older than this conversation's. Omit for the first page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  beforeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number = 30;
}
