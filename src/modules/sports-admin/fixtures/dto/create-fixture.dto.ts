import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** HH:mm or HH:mm:ss, 24-hour. Matches how sports_fixtures.fixture_time (@db.Time) is stored. */
export const FIXTURE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateFixtureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsInt()
  team_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  opponent?: string;

  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsBoolean()
  is_home?: boolean;

  @IsDateString()
  fixture_date: string;

  @IsOptional()
  @IsString()
  @Matches(FIXTURE_TIME_PATTERN, {
    message: 'fixture_time must be in HH:mm or HH:mm:ss (24-hour) format',
  })
  fixture_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  result?: string;
}
