import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** The reference design's "Add student entry" popup for Competitions — a real student_competitions row. */
export class AddCompetitionEntryDto {
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  event_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @IsOptional()
  @IsDateString()
  held_on?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  result?: string;
}
