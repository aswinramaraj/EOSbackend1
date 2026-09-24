import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class SubmitParentFeedbackDto {
  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
