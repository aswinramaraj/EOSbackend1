import { IsInt, Max, Min } from 'class-validator';

export class MutateMappingDto {
  @IsInt()
  department_id!: number;

  @IsInt()
  @Min(1)
  @Max(8)
  semester!: number;

  @IsInt()
  subject_id!: number;
}
