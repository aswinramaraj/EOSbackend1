import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum PersonalCalendarEntryCategory {
  PERSONAL = 'personal',
  REMINDER = 'reminder',
  MEETING = 'meeting',
}

export class CreatePersonalCalendarEntryDto {
  @IsDateString()
  entry_date!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsEnum(PersonalCalendarEntryCategory)
  category?: PersonalCalendarEntryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  details?: string;
}
