import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCalendarNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  category: string;

  @IsDateString()
  event_date: string;
}
