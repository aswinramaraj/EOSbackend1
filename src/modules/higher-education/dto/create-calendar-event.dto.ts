import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /me/higher-education-calendar-events */
export class CreateCalendarEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsDateString()
  event_date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  category?: string;
}
