import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListConfidentialEventsQueryDto {
  @IsOptional()
  @IsIn(['strong_room_entry', 'file_access', 'print_run', 'seal_break', 'exception'])
  event_type?: 'strong_room_entry' | 'file_access' | 'print_run' | 'seal_break' | 'exception';

  @IsOptional()
  @IsString()
  search?: string;
}
