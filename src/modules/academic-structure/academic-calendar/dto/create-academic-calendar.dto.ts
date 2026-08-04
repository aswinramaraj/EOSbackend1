import { IsDateString, IsInt, Max, Min } from 'class-validator';

export class CreateAcademicCalendarDto {
  @IsInt()
  batch_id!: number;

  @IsInt()
  @Min(1)
  @Max(8)
  semester!: number;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;
}
