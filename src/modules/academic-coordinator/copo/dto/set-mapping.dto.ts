import { IsInt, Max, Min } from 'class-validator';

export class SetMappingDto {
  @IsInt()
  course_outcome_id!: number;

  @IsInt()
  program_outcome_id!: number;

  @IsInt()
  @Min(1)
  @Max(3)
  correlation_level!: number;
}
