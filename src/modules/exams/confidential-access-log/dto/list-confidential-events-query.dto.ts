import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ListConfidentialEventsQueryDto {
  @IsOptional()
  @IsIn(['strong_room_entry', 'file_access', 'print_run', 'seal_break', 'exception'])
  event_type?: 'strong_room_entry' | 'file_access' | 'print_run' | 'seal_break' | 'exception';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  person_user_id?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
