import { IsNumber, Min } from 'class-validator';

export class SetScorecardTargetDto {
  @IsNumber()
  @Min(0)
  target_value: number;
}
