import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** The reference design's "Add student entry" popup for Hackathons — a real student_hackathon_participations row. */
export class AddHackathonEntryDto {
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  hackathon_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  team_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsDateString()
  held_on?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  outcome?: string;
}
