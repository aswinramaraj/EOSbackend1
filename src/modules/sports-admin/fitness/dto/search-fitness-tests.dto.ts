import { IsIn, IsOptional, IsString } from 'class-validator';
import { sports_fitness_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(sports_fitness_status_enum);

export class SearchFitnessTestsDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid fitness status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: sports_fitness_status_enum;

  @IsOptional()
  @IsString()
  q?: string;
}
