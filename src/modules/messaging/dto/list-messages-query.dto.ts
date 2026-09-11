import { IsInt, IsOptional, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListMessagesQueryDto {
  /** Cursor: return messages with id lower than this one (older). Omit for the most recent page. */
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
  limit?: number = 50;
}
