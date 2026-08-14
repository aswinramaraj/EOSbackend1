import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { sports_fitness_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(sports_fitness_status_enum);

export class CreateFitnessTestDto {
  @IsInt()
  student_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  test_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  score?: string;

  @IsDateString()
  test_date: string;

  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid fitness status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: sports_fitness_status_enum;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;

  @IsOptional()
  @IsInt()
  recorded_by_staff_id?: number;
}
