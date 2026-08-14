import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { sports_coach_duty_status_enum } from 'generated/prisma/client';
import { VALID_DUTY_STATUSES } from './create-coach-profile.dto';

export class SearchCoachesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  discipline_id?: number;

  @IsOptional()
  @IsIn(VALID_DUTY_STATUSES, {
    message: `duty_status must be a valid coach duty status value (${VALID_DUTY_STATUSES.join(', ')})`,
  })
  duty_status?: sports_coach_duty_status_enum;

  @IsOptional()
  @IsString()
  q?: string;
}
