import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export const EDC_EVENT_TYPES = [
  'Workshop',
  'Hackathon',
  'Pitch Day',
  'Investor Connect',
  'Founder Meet',
  'Guest Lecture',
] as const;

export const EDC_EVENT_STATUSES = ['Upcoming', 'Registrations Open', 'Planned', 'Completed', 'Cancelled'] as const;

export class CreateEdcEventDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsIn(EDC_EVENT_TYPES)
  event_type: (typeof EDC_EVENT_TYPES)[number];

  @IsDateString()
  event_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  participants_count?: number;

  @IsOptional()
  @IsIn(EDC_EVENT_STATUSES)
  status?: (typeof EDC_EVENT_STATUSES)[number];
}
