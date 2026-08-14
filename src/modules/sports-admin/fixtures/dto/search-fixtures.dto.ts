import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { sports_team_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(sports_team_status_enum);

export class SearchFixturesDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid fixture status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: sports_team_status_enum;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  discipline_id?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
