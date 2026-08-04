import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateMessFeedbackDto {
  @IsInt()
  student_id: number;

  @IsOptional()
  @IsInt()
  hostel_id?: number;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
