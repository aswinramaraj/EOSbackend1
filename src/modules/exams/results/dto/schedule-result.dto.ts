import { IsIn, IsOptional, IsString } from 'class-validator';

export class ScheduleResultDto {
  @IsOptional()
  @IsString()
  scheduled_release_at?: string;

  @IsOptional()
  @IsString()
  channels?: string;

  @IsOptional()
  @IsIn(['embargo', 'live', 'held_back'])
  state?: 'embargo' | 'live' | 'held_back';
}
